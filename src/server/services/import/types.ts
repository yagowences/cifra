import { z } from "zod";

/** Um lançamento lido de um arquivo, antes de virar transação. */
export const parsedRowSchema = z.object({
  /** Identificador do banco (FITID no OFX), quando existe. */
  externalId: z.string().nullable(),
  /** ISO YYYY-MM-DD. */
  date: z.string(),
  /** Centavos com sinal, como string. */
  amount: z.string().regex(/^-?\d+$/),
  description: z.string(),
  memo: z.string().nullable(),
  /** Saldo após o lançamento, quando o arquivo traz (centavos, string). */
  balanceAfter: z.string().nullable(),
});

export type ParsedRow = z.infer<typeof parsedRowSchema>;

export type ParseResult = {
  rows: ParsedRow[];
  /** Saldo final declarado (centavos) e data, quando o arquivo traz. */
  declaredClosingBalance: bigint | null;
  declaredClosingDate: string | null;
  /** Saldo inicial declarado (centavos); com ele, a validação é fechada: abertura + soma = fechamento. */
  declaredOpeningBalance?: bigint | null;
  /** Avisos não fatais (linhas puladas, páginas ilegíveis). */
  warnings: string[];
  /** Confiança por campo, por linha, quando a leitura foi por IA. */
  fieldConfidence?: Array<{ date: number; amount: number; description: number }>;
  /** Custo da leitura por IA em centavos de dólar. */
  aiCostCents?: number;
};

export const rowStatusSchema = z.enum(["new", "duplicate", "possible_duplicate", "matched"]);
export type RowStatus = z.infer<typeof rowStatusSchema>;

/** Linha do lote na revisão: o que foi lido mais o veredito da dedup e a categoria sugerida. */
export const reviewRowSchema = parsedRowSchema.extend({
  /** Chave estável dentro do lote. */
  key: z.string(),
  status: rowStatusSchema,
  /** Id da transação existente com que a linha bate (duplicata ou previsão casada). */
  matchId: z.string().nullable(),
  matchReason: z.string().nullable(),
  suggestedCategoryId: z.string().nullable(),
  /** 0–1; null quando não houve sugestão. */
  confidence: z.number().min(0).max(1).nullable(),
  /** Confiança por campo quando a leitura foi por IA (PDF); ausente em OFX/CSV. */
  fieldConfidence: z.object({ date: z.number(), amount: z.number(), description: z.number() }).optional(),
});

/** Linha lida por IA com algum campo abaixo de 0,80: destacada e fora da seleção padrão. */
export const isLowConfidence = (row: { fieldConfidence?: { date: number; amount: number; description: number } }) =>
  Boolean(row.fieldConfidence && Object.values(row.fieldConfidence).some((c) => c < 0.8));

export type ReviewRow = z.infer<typeof reviewRowSchema>;

export const csvMappingSchema = z.object({
  date: z.number().int().min(0),
  description: z.number().int().min(0),
  amount: z.number().int().min(0).nullable(),
  /** Alternativa a `amount`: colunas separadas de crédito e débito. */
  credit: z.number().int().min(0).nullable(),
  debit: z.number().int().min(0).nullable(),
  memo: z.number().int().min(0).nullable(),
  dateFormat: z.enum(["DMY", "YMD", "MDY"]),
  hasHeader: z.boolean(),
  /** Débitos aparecem positivos numa coluna própria ou o sinal já vem no valor. */
  invertSign: z.boolean(),
});

export type CsvMapping = z.infer<typeof csvMappingSchema>;
