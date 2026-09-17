import { z } from "zod";
import { isISODate } from "@/lib/dates";

const confidence = z.number().min(0).max(1);
const isoDate = z.string().refine(isISODate, "data deve ser YYYY-MM-DD");
/** Centavos com sinal, inteiro: o modelo lê, não calcula. */
const cents = z.number().int();

export const statementRowSchema = z.object({
  date: isoDate,
  amount: cents,
  description: z.string().min(1),
  balanceAfter: cents.nullable(),
  confidence: z.object({ date: confidence, amount: confidence, description: confidence }),
});

export const statementExtractionSchema = z.object({
  rows: z.array(statementRowSchema),
  openingBalance: cents.nullable(),
  closingBalance: cents.nullable(),
  /** Páginas que o modelo não conseguiu ler; o resto importa mesmo assim. */
  unreadablePages: z.array(z.number().int().positive()).default([]),
});

export type StatementRow = z.infer<typeof statementRowSchema>;
export type StatementExtraction = z.infer<typeof statementExtractionSchema>;
