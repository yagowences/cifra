import { z } from "zod";
import { centsSchema } from "./transaction";

const dayOfMonth = z.coerce.number().int().min(1).max(31);

export const accountInputSchema = z
  .object({
    name: z.string().trim().min(1, "Dê um nome à conta.").max(60),
    type: z.enum(["CHECKING", "SAVINGS", "CREDIT_CARD", "CASH", "INVESTMENT", "OTHER"]),
    institution: z.string().trim().max(60).nullable().optional(),
    /** Saldo inicial em centavos, com sinal (cartão pode começar negativo). */
    initialBalance: centsSchema.default("0"),
    closingDay: dayOfMonth.nullable().optional(),
    dueDay: dayOfMonth.nullable().optional(),
    creditLimit: centsSchema.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "CREDIT_CARD" && (!v.closingDay || !v.dueDay)) {
      ctx.addIssue({ code: "custom", path: ["closingDay"], message: "Cartão precisa de dia de fechamento e de vencimento." });
    }
  });

export type AccountInput = z.infer<typeof accountInputSchema>;
