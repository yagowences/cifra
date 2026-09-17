import "server-only";
import type { Prisma } from "@prisma/client";
import { addMonths, daysInMonth, formatMonthYear, fromISODate, monthPeriod, todayISO, toISODate, type ISODate } from "@/lib/dates";
import { normalizeDescription } from "@/lib/fingerprint";
import {
  dailyPaceText,
  detectCategorySpikes,
  detectDailyPace,
  detectSubscriptions,
  previousMonths,
  spikeText,
  subscriptionsText,
  type CategoryHistory,
  type MerchantRow,
} from "@/lib/insights";
import type { UserDb } from "@/server/db";

type Draft = { type: string; severity: "INFO" | "ATTENTION"; title: string; body: string; data: Prisma.InputJsonObject; periodStart: ISODate; periodEnd: ISODate };

/**
 * Roda os detectores determinísticos para o mês de `today` e grava os insights
 * (um por tipo e período; rodar de novo atualiza em vez de duplicar).
 * O texto vem de template: nenhum número é gerado por modelo.
 */
export async function generateInsights(tx: UserDb, userId: string, today: ISODate = todayISO()): Promise<number> {
  const month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const period = monthPeriod(y, m);
  const monthName = formatMonthYear(y, m).split(" ")[0].toLowerCase();
  const drafts: Draft[] = [];

  // Aumento incomum por categoria: mês atual contra os 6 anteriores.
  const prev6 = previousMonths(month, 6);
  const [p6y, p6m] = prev6[0].split("-").map(Number);
  const byMonth = await tx.$queryRaw<{ month: string; category_id: string | null; name: string | null; total: bigint }[]>`
    select to_char(t.competence_date, 'YYYY-MM') as month, c.id as category_id, c.name, sum(-t.amount)::bigint as total
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.user_id = ${userId}::uuid
      and t.type = 'EXPENSE' and t.status in ('CONFIRMED', 'RECONCILED')
      and t.competence_date between ${fromISODate(monthPeriod(p6y, p6m).start)} and ${fromISODate(period.end)}
    group by 1, 2, 3
  `;
  const categories = new Map<string, CategoryHistory>();
  for (const r of byMonth) {
    const key = r.category_id ?? "none";
    const h = categories.get(key) ?? { categoryId: r.category_id, name: r.name ?? "Sem categoria", current: 0n, previous: [] };
    if (r.month === month) h.current = BigInt(r.total);
    categories.set(key, h);
  }
  for (const h of categories.values()) {
    h.previous = prev6.map((pm) => BigInt(byMonth.find((r) => r.month === pm && (r.category_id ?? "none") === (h.categoryId ?? "none"))?.total ?? 0n)).filter((v, i) => v > 0n || prev6[i] >= month);
  }
  for (const spike of detectCategorySpikes(Array.from(categories.values()))) {
    const text = spikeText(spike, monthName);
    drafts.push({
      type: `category_spike:${spike.categoryId ?? "none"}`,
      severity: "ATTENTION",
      ...text,
      data: { categoryId: spike.categoryId, current: spike.current.toString(), mean: spike.mean.toString(), percentUp: spike.percentUp, zScore: spike.zScore },
      periodStart: period.start,
      periodEnd: period.end,
    });
  }

  // Assinaturas: últimos 13 meses por comerciante.
  const since = addMonths(`${month}-01`, -13);
  const merchantRows = await tx.transaction.findMany({
    where: { userId, type: "EXPENSE", status: { in: ["CONFIRMED", "RECONCILED"] }, competenceDate: { gte: fromISODate(since), lte: fromISODate(period.end) } },
    select: { description: true, merchant: true, competenceDate: true, amount: true, category: { select: { name: true } } },
  });
  const rows: MerchantRow[] = merchantRows.map((r) => ({
    merchantKey: normalizeDescription(r.merchant ?? r.description).replace(/\b\d+\b/g, "").trim(),
    description: r.merchant ?? r.description,
    date: toISODate(r.competenceDate),
    amount: r.amount,
    categoryName: r.category?.name ?? null,
  }));
  const subs = detectSubscriptions(rows).filter((s) => s.cadence === "monthly");
  if (subs.length > 0) {
    drafts.push({
      type: "subscriptions",
      severity: "INFO",
      ...subscriptionsText(subs),
      data: { subscriptions: subs.map((s) => ({ description: s.description, amount: s.amount.toString(), occurrences: s.occurrences, lastDate: s.lastDate })) },
      periodStart: period.start,
      periodEnd: period.end,
    });
  }

  // Gasto médio diário acima do padrão.
  const prev3 = previousMonths(month, 3);
  const monthExpense = byMonth.filter((r) => r.month === month).reduce((s, r) => s + BigInt(r.total), 0n);
  const pace = detectDailyPace({
    monthExpense,
    daysElapsed: Number(today.slice(8, 10)),
    daysInMonth: daysInMonth(y, m),
    previousMonthsExpense: prev3.map((pm) => byMonth.filter((r) => r.month === pm).reduce((s, r) => s + BigInt(r.total), 0n)),
    previousMonthsDays: prev3.map((pm) => daysInMonth(...(pm.split("-").map(Number) as [number, number]))),
  });
  if (pace) {
    drafts.push({
      type: "daily_pace",
      severity: "ATTENTION",
      ...dailyPaceText(pace),
      data: { averageDaily: pace.averageDaily.toString(), typicalDaily: pace.typicalDaily.toString(), percentUp: pace.percentUp },
      periodStart: period.start,
      periodEnd: period.end,
    });
  }

  for (const d of drafts) {
    const existing = await tx.insight.findFirst({ where: { userId, type: d.type, periodStart: fromISODate(d.periodStart) } });
    const data = { severity: d.severity, title: d.title, body: d.body, data: d.data };
    if (existing) await tx.insight.update({ where: { id: existing.id }, data });
    else await tx.insight.create({ data: { userId, type: d.type, ...data, periodStart: fromISODate(d.periodStart), periodEnd: fromISODate(d.periodEnd) } });
  }
  return drafts.length;
}

export type InsightView = { id: string; type: string; severity: "INFO" | "ATTENTION"; title: string; body: string; href: string; read: boolean };

export async function listInsights(tx: UserDb, userId: string, month: string, limit = 4): Promise<InsightView[]> {
  const [y, m] = month.split("-").map(Number);
  const rows = await tx.insight.findMany({
    where: { userId, dismissed: false, periodStart: fromISODate(monthPeriod(y, m).start) },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
  return rows.map((r) => {
    const data = (r.data ?? {}) as { categoryId?: string | null };
    const href = r.type.startsWith("category_spike:")
      ? `/transacoes?mes=${month}&tipo=EXPENSE&categoria=${data.categoryId ?? "nenhuma"}`
      : `/transacoes?mes=${month}&tipo=EXPENSE`;
    return { id: r.id, type: r.type, severity: r.severity, title: r.title, body: r.body, href, read: r.read };
  });
}
