import { z } from "zod";
import { isISODate } from "@/lib/dates";

const confidence = z.number().min(0).max(1);

export const receiptSchema = z.object({
  /** Total em centavos, positivo. */
  amount: z.number().int().positive(),
  date: z.string().refine(isISODate, "data deve ser YYYY-MM-DD"),
  merchant: z.string().min(1),
  paymentMethod: z.enum(["credit", "debit", "pix", "cash", "unknown"]).default("unknown"),
  cardLast4: z.string().regex(/^\d{4}$/).nullable().default(null),
  suggestedCategory: z.string().nullable().default(null),
  items: z.array(z.object({ description: z.string(), amount: z.number().int().nullable() })).default([]),
  confidence: z.object({ amount: confidence, date: confidence, merchant: confidence }),
});

export type Receipt = z.infer<typeof receiptSchema>;
