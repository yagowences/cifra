import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { addMonths, fromISODate, monthPeriod, todayISO, toISODate, type ISODate } from "@/lib/dates";
import { fingerprint } from "@/lib/fingerprint";
import { signedAmount } from "@/lib/money";
import { formatRRule, nextOccurrenceAfter, occurrencesBetween, parseRRule, type RecurrenceRule } from "@/lib/recurrence";
import type { UserDb } from "@/server/db";
import type { TransactionInput } from "@/server/schemas/transaction";
import { NotFoundError } from "./transactions";

/** O que a regra repete. Guardado em recurrence_rules.template (JSON). */
export const recurrenceTemplateSchema = z.object({
  accountId: z.string().min(1),
  type: z.enum(["INCOME", "EXPENSE", "TRANSFER"]),
  /** Magnitude em centavos, como string. */
  amount: z.string().regex(/^\d+$/),
  description: z.string().min(1),
  categoryId: z.string().nullable(),
  transferAccountId: z.string().nullable(),
  notes: z.string().nullable(),
  merchant: z.string().nullable(),
  /** Data da primeira ocorrência (DTSTART). */
  start: z.string(),
});

export type RecurrenceTemplate = z.infer<typeof recurrenceTemplateSchema>;

function templateFrom(input: TransactionInput): RecurrenceTemplate {
  return {
    accountId: input.accountId,
    type: input.type,
    amount: input.amount.toString(),
    description: input.description,
    categoryId: input.type === "TRANSFER" ? null : (input.categoryId ?? null),
    transferAccountId: input.type === "TRANSFER" ? (input.transferAccountId ?? null) : null,
    notes: input.notes ?? null,
    merchant: input.merchant ?? null,
    start: input.competenceDate,
  };
}

/** Cria a regra e já materializa as ocorrências até o fim do mês seguinte. */
export async function createRecurrence(tx: UserDb, userId: string, input: TransactionInput, rule: RecurrenceRule, today: ISODate = todayISO()) {
  const template = templateFrom(input);
  const created = await tx.recurrenceRule.create({
    data: {
      userId,
      template,
      rrule: formatRRule(rule),
      nextOccurrence: fromISODate(input.competenceDate),
      active: true,
    },
  });
  await materializeRecurrences(tx, userId, { until: horizonFor(today), today });
  return created;
}

/** Fim do mês seguinte a `today`: até onde ocorrências previstas existem como linhas. */
export function horizonFor(today: ISODate): ISODate {
  const [y, m] = addMonths(today, 1).split("-").map(Number);
  return monthPeriod(y, m).end;
}

/**
 * Gera as ocorrências pendentes de todas as regras ativas até `until`.
 * Idempotente: cada ocorrência tem fingerprint próprio (regra + data) e recurrence_id.
 * Ocorrência de hoje ou passada nasce CONFIRMED; futura nasce PROJECTED e é
 * promovida quando a data chega. Devolve quantas linhas foram criadas.
 */
export async function materializeRecurrences(
  tx: UserDb,
  userId: string,
  opts: { until: ISODate; today?: ISODate },
): Promise<number> {
  const today = opts.today ?? todayISO();
  const rules = await tx.recurrenceRule.findMany({ where: { userId, active: true, nextOccurrence: { lte: fromISODate(opts.until) } } });
  let created = 0;

  for (const rule of rules) {
    const template = recurrenceTemplateSchema.parse(rule.template);
    const parsed = parseRRule(rule.rrule);
    const from = toISODate(rule.nextOccurrence);
    const dates = occurrencesBetween(template.start, parsed, { from, until: opts.until });
    if (dates.length === 0) {
      await tx.recurrenceRule.update({ where: { id: rule.id }, data: { active: false } });
      continue;
    }

    const amount = signedAmount(template.type, BigInt(template.amount));
    const rows: Prisma.TransactionCreateManyInput[] = dates.map((date) => ({
      userId,
      accountId: template.accountId,
      categoryId: template.categoryId,
      transferAccountId: template.transferAccountId,
      amount,
      type: template.type,
      competenceDate: fromISODate(date),
      description: template.description,
      notes: template.notes,
      merchant: template.merchant,
      status: date <= today ? "CONFIRMED" : "PROJECTED",
      source: "RECURRENCE",
      recurrenceId: rule.id,
      fingerprint: fingerprint({ accountId: template.accountId, competenceDate: date, amount, description: `${template.description} #${rule.id}` }),
    }));
    const result = await tx.transaction.createMany({ data: rows, skipDuplicates: true });
    created += result.count;

    const last = dates[dates.length - 1];
    const next = nextOccurrenceAfter(template.start, parsed, last);
    await tx.recurrenceRule.update({
      where: { id: rule.id },
      data: next ? { nextOccurrence: fromISODate(next) } : { nextOccurrence: fromISODate(last), active: false },
    });
  }

  // Previsões cuja data chegou viram efetivas (e passam a contar no saldo).
  await tx.transaction.updateMany({
    where: { userId, status: "PROJECTED", recurrenceId: { not: null }, competenceDate: { lte: fromISODate(today) } },
    data: { status: "CONFIRMED" },
  });

  return created;
}

/** Encerra a regra e remove as ocorrências ainda previstas (as efetivas ficam). */
export async function stopRecurrence(tx: UserDb, userId: string, ruleId: string) {
  const rule = await tx.recurrenceRule.findFirst({ where: { id: ruleId, userId } });
  if (!rule) throw new NotFoundError("Recorrência");
  const removed = await tx.transaction.deleteMany({ where: { userId, recurrenceId: ruleId, status: "PROJECTED" } });
  await tx.recurrenceRule.update({ where: { id: ruleId }, data: { active: false } });
  return removed.count;
}
