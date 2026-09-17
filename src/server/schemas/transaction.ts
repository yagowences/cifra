import { z } from "zod";
import { isISODate } from "@/lib/dates";

export const isoDateSchema = z.string().refine(isISODate, "Data inválida.");

/** Centavos como string decimal (bigint não atravessa a fronteira do formulário). */
export const centsSchema = z
  .string()
  .regex(/^-?\d+$/, "Valor inválido.")
  .transform((s) => BigInt(s));

export const transactionInputSchema = z
  .object({
    accountId: z.string().min(1, "Escolha a conta."),
    type: z.enum(["INCOME", "EXPENSE", "TRANSFER"]),
    /** Magnitude em centavos, sempre positiva; o sinal vem do tipo. */
    amount: centsSchema.refine((v) => v > 0n, "Informe um valor maior que zero."),
    competenceDate: isoDateSchema,
    cashDate: isoDateSchema.nullable().optional(),
    description: z.string().trim().min(1, "Descreva o lançamento.").max(200),
    categoryId: z.string().min(1).nullable().optional(),
    transferAccountId: z.string().min(1).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    merchant: z.string().trim().max(120).nullable().optional(),
    status: z.enum(["PENDING", "CONFIRMED", "RECONCILED", "PROJECTED", "IGNORED"]).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "TRANSFER") {
      if (!v.transferAccountId) ctx.addIssue({ code: "custom", path: ["transferAccountId"], message: "Escolha a conta de destino." });
      if (v.transferAccountId === v.accountId) ctx.addIssue({ code: "custom", path: ["transferAccountId"], message: "Origem e destino precisam ser contas diferentes." });
      if (v.categoryId) ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Transferência não tem categoria." });
    } else if (v.transferAccountId) {
      ctx.addIssue({ code: "custom", path: ["transferAccountId"], message: "Só transferência tem conta de destino." });
    }
  });

export type TransactionInput = z.infer<typeof transactionInputSchema>;

export const transactionFiltersSchema = z.object({
  /** "YYYY-MM"; padrão é o mês atual. */
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  accountId: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  type: z.enum(["INCOME", "EXPENSE", "TRANSFER"]).optional(),
  q: z.string().trim().max(100).optional(),
  minAmount: centsSchema.optional(),
  maxAmount: centsSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export type TransactionFilters = z.infer<typeof transactionFiltersSchema>;
