/**
 * Importação de PDF com o modelo falso: camada de texto detectada, validação
 * de saldo em código (abertura + soma = fechamento), confiança por campo na
 * revisão e páginas ilegíveis reportadas. Integração (banco).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiClient, Extracted, FileRef } from "@/ai/client";
import type { StatementExtraction } from "@/ai/schemas/statement";
import { db, forUser } from "@/server/db";
import { createAccount } from "@/server/services/accounts";
import { processImportBatch, readReviewRows, startImport } from "./index";
import { pdfTextLayer } from "./parsers/pdf";
import { isLowConfidence } from "./types";

const hasDb = Boolean(process.env.DATABASE_URL);
const userId = randomUUID();

/** PDF mínimo, uma página, com texto em Helvetica (o xref é reconstruído pelo leitor). */
function minimalPdf(text: string): Uint8Array {
  const content = `BT /F1 12 Tf 40 700 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) body += `${String(o).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

const STATEMENT_TEXT = "EXTRATO NUBANK 09/2026 SALDO ANTERIOR 1.000,00 03/09 IFOOD -42,90 05/09 SALARIO 4.800,00 SALDO FINAL 5.757,10 CPF 123.456.789-09 fim do extrato";

class FakeAi implements AiClient {
  calls: FileRef[] = [];
  constructor(private extraction: StatementExtraction) {}
  async extractStatement(_userId: string, file: FileRef): Promise<Extracted<StatementExtraction>> {
    this.calls.push(file);
    return { data: this.extraction, model: "fake", costCents: 1.5, cached: false };
  }
  extractReceipt(): never {
    throw new Error("não usado");
  }
  async categorize(): Promise<Extracted<{ results: [] }>> {
    return { data: { results: [] }, model: "fake", costCents: 0, cached: false };
  }
}

describe.skipIf(!hasDb)("importação de PDF", () => {
  let accountId = "";

  beforeAll(async () => {
    await db.$executeRaw`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', ${userId}::uuid, 'authenticated', 'authenticated',
        ${`pdf-${userId}@cifra.test`}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
    `;
    accountId = (await forUser(userId, (tx) => createAccount(tx, userId, { name: "Nubank", type: "CHECKING", initialBalance: 0n, institution: "Nubank" }))).id;
  });

  afterAll(async () => {
    await db.$executeRaw`delete from auth.users where id = ${userId}::uuid`;
    await db.$disconnect();
  });

  it("detecta a camada de texto de um PDF", async () => {
    const layer = await pdfTextLayer(minimalPdf(STATEMENT_TEXT));
    expect(layer.pages).toBe(1);
    expect(layer.hasTextLayer).toBe(true);
    expect(layer.text).toContain("IFOOD");
    expect(layer.repaired).toBe(false);
  });

  it("recupera um PDF com zeros (download interrompido) antes do cabeçalho", async () => {
    const padded = new Uint8Array(2000 + minimalPdf(STATEMENT_TEXT).length);
    padded.set(minimalPdf(STATEMENT_TEXT), 2000);
    const layer = await pdfTextLayer(padded);
    expect(layer.repaired).toBe(true);
    expect(layer.text).toContain("IFOOD");
  });

  it("sem cabeçalho %PDF em lugar nenhum, dá erro explicando a causa provável", async () => {
    const garbage = new Uint8Array(500);
    await expect(pdfTextLayer(garbage)).rejects.toThrow(/corrompido|incompleto|senha/);
  });

  it("com saldo de abertura e fechamento, a soma confere em código e a confiança baixa vem marcada", async () => {
    const ai = new FakeAi({
      rows: [
        { date: "2026-09-03", amount: -4290, description: "IFOOD", balanceAfter: 95710, confidence: { date: 0.99, amount: 0.97, description: 0.95 } },
        { date: "2026-09-05", amount: 480000, description: "SALARIO", balanceAfter: 575710, confidence: { date: 0.9, amount: 0.61, description: 0.9 } },
      ],
      openingBalance: 100000,
      closingBalance: 575710,
      unreadablePages: [4, 5],
    });
    const bytes = minimalPdf(STATEMENT_TEXT);
    const batch = await forUser(userId, (tx) => startImport(tx, userId, { accountId, fileName: "extrato.pdf", storageKey: `${userId}/imports/a.pdf`, format: "PDF", bytes }));
    await processImportBatch(batch.id, bytes, null, { ai });

    // Foi texto redigido ao modelo, não o PDF: o CPF não chega lá.
    expect(ai.calls[0].kind).toBe("text");
    expect(JSON.stringify(ai.calls[0])).not.toContain("123.456.789-09");

    const after = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(after.status).toBe("READY_FOR_REVIEW");
    expect(after.balanceDiff).toBe(0n);
    expect(after.declaredOpeningBalance).toBe(100000n);
    expect(after.aiCostCents).toBe(2);
    expect(after.error).toMatch(/páginas 4 e 5/);

    const rows = readReviewRows(after);
    expect(rows).toHaveLength(2);
    expect(rows[0].fieldConfidence).toEqual({ date: 0.99, amount: 0.97, description: 0.95 });
    expect(isLowConfidence(rows[0])).toBe(false);
    expect(isLowConfidence(rows[1])).toBe(true);
  });

  it("saldo que não bate vira diferença exibida, nunca importação silenciosa", async () => {
    const ai = new FakeAi({
      rows: [{ date: "2026-09-03", amount: -4290, description: "IFOOD", balanceAfter: null, confidence: { date: 0.99, amount: 0.97, description: 0.95 } }],
      openingBalance: 100000,
      closingBalance: 94470,
      unreadablePages: [],
    });
    const bytes = minimalPdf(`${STATEMENT_TEXT} v2`);
    const batch = await forUser(userId, (tx) => startImport(tx, userId, { accountId, fileName: "extrato2.pdf", storageKey: `${userId}/imports/b.pdf`, format: "PDF", bytes }));
    await processImportBatch(batch.id, bytes, null, { ai });
    const after = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(after.status).toBe("READY_FOR_REVIEW");
    // 100.000 − 4.290 = 95.710; declarado 94.470 → diferença de −1.240.
    expect(after.balanceDiff).toBe(-1240n);
  });

  it("falha do modelo deixa o lote em FAILED com a mensagem, sem criar nada", async () => {
    const ai: AiClient = {
      extractStatement: async () => {
        throw new Error("A IA não devolveu um resultado válido para extractStatement; vai para revisão manual.");
      },
      extractReceipt: async () => {
        throw new Error("não usado");
      },
      categorize: async () => ({ data: { results: [] }, model: "fake", costCents: 0, cached: false }),
    };
    const bytes = minimalPdf("ilegivel");
    const batch = await forUser(userId, (tx) => startImport(tx, userId, { accountId, fileName: "ruim.pdf", storageKey: `${userId}/imports/c.pdf`, format: "PDF", bytes }));
    await expect(processImportBatch(batch.id, bytes, null, { ai })).rejects.toThrow(/revisão manual/);
    const after = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(after.status).toBe("FAILED");
    expect(after.error).toMatch(/revisão manual/);
    expect(await db.transaction.count({ where: { userId } })).toBe(0);
  });
});
