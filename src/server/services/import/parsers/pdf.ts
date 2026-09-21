import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import type { AiClient, BankHint } from "@/ai/client";
import type { ParseResult } from "../types";

/** Menos que isto por página é PDF sem camada de texto (escaneado). */
const MIN_TEXT_PER_PAGE = 40;

const PDF_MAGIC = new TextEncoder().encode("%PDF-");

const CORRUPTED_MESSAGE =
  "Não consegui ler este PDF: ele parece corrompido, incompleto ou protegido por senha. Costuma acontecer quando o download foi interrompido. Baixe o arquivo de novo (do banco, e-mail ou app) e tente importar outra vez.";

/** Acha o `%PDF-` no arquivo; downloads corrompidos às vezes grudam lixo (ou zeros) antes do cabeçalho real. */
function findPdfHeader(bytes: Uint8Array): number {
  outer: for (let i = 0; i <= bytes.length - PDF_MAGIC.length; i++) {
    for (let j = 0; j < PDF_MAGIC.length; j++) {
      if (bytes[i + j] !== PDF_MAGIC[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export type PdfText = { text: string; pages: number; hasTextLayer: boolean; repaired: boolean };

/**
 * Camada de texto do PDF, quando existe. Tolera lixo (ou um bloco de zeros) antes do cabeçalho
 * `%PDF-` — sintoma comum de download interrompido — recortando até achar o início real do
 * documento antes de tentar ler; se não achar cabeçalho nenhum, ou a leitura falhar mesmo assim,
 * dá erro com uma mensagem que explica a causa provável, não o erro interno do parser.
 */
export async function pdfTextLayer(bytes: Uint8Array): Promise<PdfText> {
  const headerAt = findPdfHeader(bytes);
  if (headerAt === -1) throw new Error(CORRUPTED_MESSAGE);
  const repaired = headerAt > 0;
  const usable = repaired ? bytes.subarray(headerAt) : bytes;

  try {
    const pdf = await getDocumentProxy(usable);
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const clean = text.replace(/\s+\n/g, "\n").trim();
    return { text: clean, pages: totalPages, hasTextLayer: clean.length >= MIN_TEXT_PER_PAGE * Math.max(1, totalPages), repaired };
  } catch {
    throw new Error(CORRUPTED_MESSAGE);
  }
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
  if (layer.repaired) warnings.push("Este PDF tinha dados corrompidos antes do início do documento (comum em downloads interrompidos); consegui recuperar automaticamente. Confira os valores com atenção.");
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
