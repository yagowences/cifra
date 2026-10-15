/**
 * Integração: importar o mesmo OFX duas vezes não cria duplicata; previsão
 * casada vira a própria transação; desfazer remove tudo e devolve a previsão.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AiClient, Extracted } from "@/ai/client";
import { ProviderUnavailableError } from "@/ai/providers/errors";
import type { Categorized } from "@/ai/schemas/categorize";
import { db, forUser } from "@/server/db";
import { createAccount } from "@/server/services/accounts";
import { createTransaction } from "@/server/services/transactions";
import { confirmImport, ImportError, processImportBatch, readReviewRows, startImport, undoImport } from "./index";

const hasDb = Boolean(process.env.DATABASE_URL);
const userId = randomUUID();

/** O provedor de IA fora do ar durante a categorização: o 503 que já derrubou lote em produção. */
class AiForaDoAr implements AiClient {
  calls = 0;
  async categorize(): Promise<never> {
    this.calls++;
    throw new ProviderUnavailableError("O Gemini está sobrecarregado agora. Tente de novo em alguns minutos.", true);
  }
  extractStatement(): never {
    throw new Error("não usado");
  }
  extractReceipt(): never {
    throw new Error("não usado");
  }
}

/** IA disponível: sugere a mesma categoria para tudo que lhe mandarem. */
class AiCategoriza implements AiClient {
  calls = 0;
  constructor(private categoryId: string) {}
  async categorize(_userId: string, txs: { index: number }[]): Promise<Extracted<Categorized>> {
    this.calls++;
    return { data: { results: txs.map((t) => ({ index: t.index, categoryId: this.categoryId, confidence: 0.8 })) }, model: "fake", costCents: 0, cached: false };
  }
  extractStatement(): never {
    throw new Error("não usado");
  }
  extractReceipt(): never {
    throw new Error("não usado");
  }
}

const ofxCom = (fitid: string, dia: string, nome: string) => `OFXHEADER:100
<OFX><BANKTRANLIST>
<STMTTRN><DTPOSTED>${dia}<TRNAMT>-20.00<FITID>${fitid}<NAME>${nome}</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1000.00<DTASOF>${dia}</LEDGERBAL>
</OFX>`;

/** Descrições e FITIDs que nenhuma importação anterior viu: nem regra, nem memória, nem vizinho resolvem. */
const OFX_INEDITO = `OFXHEADER:100
<OFX><BANKTRANLIST>
<STMTTRN><DTPOSTED>20260920<TRNAMT>-15.00<FITID>g1<NAME>PADARIA ESTRELA DO NORTE</STMTTRN>
<STMTTRN><DTPOSTED>20260921<TRNAMT>-60.00<FITID>g2<NAME>OFICINA MECANICA ZE</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1000.00<DTASOF>20260921</LEDGERBAL>
</OFX>`;

const OFX = `OFXHEADER:100
<OFX><BANKTRANLIST>
<STMTTRN><DTPOSTED>20260903<TRNAMT>-42.90<FITID>f1<NAME>IFD*IFOOD SAO PAULO</STMTTRN>
<STMTTRN><DTPOSTED>20260905<TRNAMT>-928.40<FITID>f2<NAME>TED ALUGUEL</STMTTRN>
<STMTTRN><DTPOSTED>20260910<TRNAMT>4800.00<FITID>f3<NAME>TED RECEBIDA ACME</NAME></STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>4828.70<DTASOF>20260917</LEDGERBAL>
</OFX>`;

const bytes = new TextEncoder().encode(OFX);

describe.skipIf(!hasDb)("pipeline de importação", () => {
  let accountId = "";
  let projectedId = "";

  beforeAll(async () => {
    await db.$executeRaw`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', ${userId}::uuid, 'authenticated', 'authenticated',
        ${`imp-${userId}@cifra.test`}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
    `;
    await forUser(userId, async (tx) => {
      const account = await createAccount(tx, userId, { name: "Nubank", type: "CHECKING", initialBalance: 100_000n, institution: null });
      accountId = account.id;
      const projected = await createTransaction(tx, userId, {
        accountId,
        type: "EXPENSE",
        amount: 92_840n,
        competenceDate: "2026-09-05",
        description: "Aluguel",
        status: "PROJECTED",
      });
      projectedId = projected.id;
    });
  });

  afterAll(async () => {
    await db.$executeRaw`delete from auth.users where id = ${userId}::uuid`;
    await db.$disconnect();
  });

  it("primeira importação: 2 novas, 1 casada com a previsão, saldo confere", async () => {
    const batch = await forUser(userId, (tx) => startImport(tx, userId, { accountId, fileName: "extrato.ofx", storageKey: `${userId}/imports/x.ofx`, format: "OFX", bytes }));
    await processImportBatch(batch.id, bytes, null, { ai: null });

    const after = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(after.status).toBe("READY_FOR_REVIEW");
    const rows = readReviewRows(after);
    expect(rows.map((r) => r.status)).toEqual(["new", "matched", "new"]);
    expect(rows[1].matchId).toBe(projectedId);
    // Conta: 1.000 + (−42,90 − 928,40 + 4.800) = 4.828,70 = saldo declarado.
    expect(after.balanceDiff).toBe(0n);

    const confirmed = await forUser(userId, (tx) => confirmImport(tx, userId, batch.id, rows.map((r) => ({ key: r.key, categoryId: null }))));
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.createdCount).toBe(3);

    const txs = await db.transaction.findMany({ where: { userId }, orderBy: { competenceDate: "asc" } });
    expect(txs).toHaveLength(3);
    const rent = txs.find((t) => t.id === projectedId)!;
    expect(rent.status).toBe("CONFIRMED");
    expect(rent.externalId).toBe("f2");
    expect(rent.originalDesc).toBe("TED ALUGUEL");
    expect((await db.account.findUniqueOrThrow({ where: { id: accountId } })).currentBalance).toBe(482_870n);
  });

  it("importar o mesmo arquivo de novo não cria duplicata", async () => {
    const batch = await forUser(userId, (tx) => startImport(tx, userId, { accountId, fileName: "extrato.ofx", storageKey: `${userId}/imports/y.ofx`, format: "OFX", bytes }));
    await processImportBatch(batch.id, bytes, null, { ai: null });
    const rows = readReviewRows(await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } }));
    expect(rows.every((r) => r.status === "duplicate")).toBe(true);
    expect(rows.map((r) => r.matchReason)).toEqual(Array(3).fill("Mesmo identificador do banco"));

    await expect(forUser(userId, (tx) => confirmImport(tx, userId, batch.id, [{ key: rows[0].key, categoryId: null }]))).rejects.toBeInstanceOf(ImportError);
    expect(await db.transaction.count({ where: { userId } })).toBe(3);
  });

  it("desfazer remove o que o lote criou e devolve a previsão", async () => {
    const first = await db.importBatch.findFirstOrThrow({ where: { userId, status: "CONFIRMED" } });
    await forUser(userId, (tx) => undoImport(tx, userId, first.id));
    const txs = await db.transaction.findMany({ where: { userId } });
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ id: projectedId, status: "PROJECTED", externalId: null, importBatchId: null, originalDesc: "TED ALUGUEL" });
    expect((await db.account.findUniqueOrThrow({ where: { id: accountId } })).currentBalance).toBe(100_000n);
  });

  it("IA fora do ar durante a categorização não derruba o lote: linhas intactas, categorias em branco", async () => {
    const ai = new AiForaDoAr();
    const inedito = new TextEncoder().encode(OFX_INEDITO);
    const batch = await forUser(userId, (tx) => startImport(tx, userId, { accountId, fileName: "extrato3.ofx", storageKey: `${userId}/imports/z.ofx`, format: "OFX", bytes: inedito }));

    await expect(processImportBatch(batch.id, inedito, null, { ai })).resolves.toBeUndefined();

    const after = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(after.status).toBe("READY_FOR_REVIEW");
    const rows = readReviewRows(after);
    expect(rows.map((r) => r.status)).toEqual(["new", "new"]);
    expect(rows.every((r) => !r.suggestedCategoryId)).toBe(true);
    // Trava contra falso verde: se a IA nem foi chamada, o teste não provou nada.
    expect(ai.calls).toBeGreaterThan(0);
  });

  it("IA disponível: as sugestões entram depois do commit, só nas linhas que ficaram sem categoria", async () => {
    const categoria = await db.category.findFirstOrThrow({ where: { userId, type: "EXPENSE" } });
    const ai = new AiCategoriza(categoria.id);
    const arquivo = new TextEncoder().encode(ofxCom("h1", "20260922", "MERCEARIA DO BAIRRO 77"));
    const batch = await forUser(userId, (tx) => startImport(tx, userId, { accountId, fileName: "extrato4.ofx", storageKey: `${userId}/imports/w.ofx`, format: "OFX", bytes: arquivo }));

    await processImportBatch(batch.id, arquivo, null, { ai });

    const rows = readReviewRows(await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } }));
    expect(ai.calls).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].suggestedCategoryId).toBe(categoria.id);
  });

  it("com a chave configurada e AI_CATEGORIZE_IMPORT desligada, importar não chama IA nenhuma", async () => {
    // Chave presente é o caso de produção (precisa dela para ler PDF); sem a flag, OFX/CSV ficam sem rede.
    vi.stubEnv("GOOGLE_API_KEY", "chave-falsa-so-para-ligar-o-aiEnabled");
    vi.stubEnv("AI_CATEGORIZE_IMPORT", "");
    try {
      const antes = await db.aiUsageLog.count({ where: { userId } });
      const arquivo = new TextEncoder().encode(ofxCom("h2", "20260923", "BARBEARIA CLASSICA CENTRO"));
      const batch = await forUser(userId, (tx) => startImport(tx, userId, { accountId, fileName: "extrato5.ofx", storageKey: `${userId}/imports/v.ofx`, format: "OFX", bytes: arquivo }));

      await processImportBatch(batch.id, arquivo, null);

      expect((await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe("READY_FOR_REVIEW");
      // Qualquer tentativa de chamada (mesmo falhando) gravaria uma linha de uso.
      expect(await db.aiUsageLog.count({ where: { userId } })).toBe(antes);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("aprovar grava a memória de comerciante em bloco: uma linha por descrição, somando os acertos", async () => {
    const ofx = (ids: string[], day: number) => new TextEncoder().encode(`OFXHEADER:100
<OFX><BANKTRANLIST>
${ids.map((id, i) => `<STMTTRN><DTPOSTED>202610${String(day + i).padStart(2, "0")}<TRNAMT>-11.00<FITID>${id}<NAME>MERCADO DO ZE</STMTTRN>`).join("\n")}
</BANKTRANLIST>
<LEDGERBAL><BALAMT>0.00<DTASOF>20261020</LEDGERBAL>
</OFX>`);
    const category = await forUser(userId, (tx) => tx.category.findFirstOrThrow({ where: { userId, type: "EXPENSE" } }));
    const run = async (ids: string[], day: number) => {
      const file = ofx(ids, day);
      const batch = await forUser(userId, (tx) => startImport(tx, userId, { accountId, fileName: "m.ofx", storageKey: `${userId}/imports/m-${ids[0]}.ofx`, format: "OFX", bytes: file }));
      await processImportBatch(batch.id, file, null, { ai: null });
      const rows = readReviewRows(await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } }));
      await forUser(userId, (tx) => confirmImport(tx, userId, batch.id, rows.map((r) => ({ key: r.key, categoryId: category.id }))));
    };

    await run(["m1", "m2"], 11);
    const afterFirst = await db.merchantMemory.findMany({ where: { userId, categoryId: category.id } });
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].hitCount).toBe(2);

    await run(["m3"], 20);
    const afterSecond = await db.merchantMemory.findMany({ where: { userId, categoryId: category.id } });
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].hitCount).toBe(3);
  });
});
