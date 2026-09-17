import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import type { AiClient, BankHint } from "@/ai/client";
import type { ParseResult } from "../types";

/** Menos que isto por página é PDF sem camada de texto (escaneado). */
const MIN_TEXT_PER_PAGE = 40;

export type PdfText = { text: string; pages: number; hasTextLayer: boolean };

/** Camada de texto do PDF, quando existe. */
export async function pdfTextLayer(bytes: Uint8Array): Promise<PdfText> {
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  const clean = text.replace(/\s+\n/g, "\n").trim();
  return { text: clean, pages: totalPages, hasTextLayer: clean.length >= MIN_TEXT_PER_PAGE * Math.max(1, totalPages) };
}

/**
 * Leitura de PDF pelo modelo. Com camada de texto, vai texto (redigido e mais
 * barato); sem ela, vai o PDF inteiro para o modelo visual. O modelo só lê:
 * a validação de saldo roda em código.
 */
export async function parsePdf(bytes: Uint8Array, opts: { ai: AiClient; userId: string; hint: BankHint }): Promise<ParseResult> {
  const layer = await pdfTextLayer(bytes);
  const file = layer.hasTextLayer
    ? ({ kind: "text", text: layer.text } as const)
    : ({ kind: "pdf", base64: Buffer.from(bytes).toString("base64") } as const);

  const extracted = await opts.ai.extractStatement(opts.userId, file, opts.hint);
  const { rows, openingBalance, closingBalance, unreadablePages } = extracted.data;

  const warnings: string[] = [];
  if (unreadablePages.length > 0) {
    const list = unreadablePages.join(unreadablePages.length === 2 ? " e " : ", ");
    warnings.push(`Não consegui ler ${unreadablePages.length === 1 ? "a página" : "as páginas"} ${list} deste PDF.`);
  }
  if (!layer.hasTextLayer) warnings.push("PDF sem camada de texto: lido como imagem, sem redação prévia de dados pessoais.");

  return {
    rows: rows.map((r) => ({
      externalId: null,
      date: r.date,
      amount: String(r.amount),
      description: r.description,
      memo: null,
      balanceAfter: r.balanceAfter === null ? null : String(r.balanceAfter),
    })),
    declaredOpeningBalance: openingBalance === null ? null : BigInt(openingBalance),
    declaredClosingBalance: closingBalance === null ? null : BigInt(closingBalance),
    declaredClosingDate: null,
    warnings,
    fieldConfidence: rows.map((r) => r.confidence),
    aiCostCents: extracted.costCents,
  };
}
