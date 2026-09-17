import "server-only";
import { Prisma } from "@prisma/client";
import { addMonths, fromISODate, monthPeriod, type ISODate, type Period } from "@/lib/dates";
import { percentOf } from "@/lib/money";
import type { UserDb } from "@/server/db";

/**
 * Agregados do dashboard em SQL cru e parametrizado. São também as ferramentas
 * do assistente: uma query só, para a tela e o chat nunca divergirem.
 * "Efetivo" = CONFIRMED ou RECONCILED, sem transferência: a regra de toda soma.
 */
const EFFECTIVE = Prisma.sql`t.status in ('CONFIRMED', 'RECONCILED') and t.type <> 'TRANSFER'`;

const accountFilter = (accountIds?: string[]) =>
  accountIds && accountIds.length > 0 ? Prisma.sql`and t.account_id in (${Prisma.join(accountIds)})` : Prisma.empty;

export type Summary = {
  income: bigint;
  expense: bigint;
  result: bigint;
  /** Percentual do que entrou que sobrou (0 quando nada entrou). Uma casa decimal. */
  savingsRate: number;
};

export async function getSummary(tx: UserDb, userId: string, period: Period, accountIds?: string[]): Promise<Summary> {
  const [row] = await tx.$queryRaw<{ income: bigint; expense: bigint }[]>`
    select
      coalesce(sum(t.amount) filter (where t.amount > 0), 0)::bigint as income,
      coalesce(sum(-t.amount) filter (where t.amount < 0), 0)::bigint as expense
    from public.transactions t
    where t.user_id = ${userId}::uuid
      and t.competence_date between ${fromISODate(period.start)} and ${fromISODate(period.end)}
      and ${EFFECTIVE}
      ${accountFilter(accountIds)}
  `;
  const income = BigInt(row?.income ?? 0);
  const expense = BigInt(row?.expense ?? 0);
  const result = income - expense;
  return { income, expense, result, savingsRate: income > 0n ? percentOf(result, income) : 0 };
}

export type CategoryTotal = {
  categoryId: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  total: bigint;
  /** Percentual sobre o total do tipo no período, uma casa decimal. */
  percent: number;
  /** Agrupamento das categorias além do limite. */
  isOthers?: boolean;
};

/**
 * Categorias ordenadas do maior para o menor total; da (limite+1)ª em diante,
 * agrupadas em "Outros". Lançamento sem categoria aparece como "Sem categoria".
 */
export async function getByCategory(
  tx: UserDb,
  userId: string,
  period: Period,
  type: "EXPENSE" | "INCOME",
  limit = 8,
  accountIds?: string[],
): Promise<CategoryTotal[]> {
  const rows = await tx.$queryRaw<{ category_id: string | null; name: string | null; icon: string | null; color: string | null; total: bigint }[]>`
    select c.id as category_id, c.name, c.icon, c.color, sum(abs(t.amount))::bigint as total
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.user_id = ${userId}::uuid
      and t.type = ${type}::public.tx_type
      and t.competence_date between ${fromISODate(period.start)} and ${fromISODate(period.end)}
      and ${EFFECTIVE}
      ${accountFilter(accountIds)}
    group by c.id, c.name, c.icon, c.color
    order by total desc, c.name asc nulls last
  `;
  const grand = rows.reduce((sum, r) => sum + BigInt(r.total), 0n);
  const toItem = (r: (typeof rows)[number]): CategoryTotal => ({
    categoryId: r.category_id,
    name: r.name ?? "Sem categoria",
    icon: r.icon,
    color: r.color,
    total: BigInt(r.total),
    percent: percentOf(BigInt(r.total), grand),
  });
  if (rows.length <= limit) return rows.map(toItem);
  const head = rows.slice(0, limit).map(toItem);
  const othersTotal = rows.slice(limit).reduce((sum, r) => sum + BigInt(r.total), 0n);
  head.push({ categoryId: null, name: "Outros", icon: null, color: "chart-5", total: othersTotal, percent: percentOf(othersTotal, grand), isOthers: true });
  return head;
}

export type CategoryDelta = {
  categoryId: string | null;
  name: string;
  before: bigint;
  after: bigint;
  delta: bigint;
  /** Variação percentual inteira; null quando não havia base. */
  deltaPercent: number | null;
};

/** Diferença por categoria entre dois períodos (despesas), maior aumento primeiro. */
export async function comparePeriods(tx: UserDb, userId: string, before: Period, after: Period, type: "EXPENSE" | "INCOME" = "EXPENSE"): Promise<CategoryDelta[]> {
  const rows = await tx.$queryRaw<{ category_id: string | null; name: string | null; before: bigint; after: bigint }[]>`
    select c.id as category_id, c.name,
      coalesce(sum(abs(t.amount)) filter (where t.competence_date between ${fromISODate(before.start)} and ${fromISODate(before.end)}), 0)::bigint as before,
      coalesce(sum(abs(t.amount)) filter (where t.competence_date between ${fromISODate(after.start)} and ${fromISODate(after.end)}), 0)::bigint as after
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.user_id = ${userId}::uuid
      and t.type = ${type}::public.tx_type
      and (
        t.competence_date between ${fromISODate(before.start)} and ${fromISODate(before.end)}
        or t.competence_date between ${fromISODate(after.start)} and ${fromISODate(after.end)}
      )
      and ${EFFECTIVE}
    group by c.id, c.name
  `;
  return rows
    .map((r) => {
      const b = BigInt(r.before);
      const a = BigInt(r.after);
      return {
        categoryId: r.category_id,
        name: r.name ?? "Sem categoria",
        before: b,
        after: a,
        delta: a - b,
        deltaPercent: b === 0n ? null : Number(((a - b) * 100n) / b),
      };
    })
    .sort((x, y) => (y.delta > x.delta ? 1 : y.delta < x.delta ? -1 : 0));
}

export type MonthFlow = { month: string; income: bigint; expense: bigint; result: bigint };

/** Série mensal (entradas, saídas, resultado) dos últimos `months` meses terminando no mês de `endMonth` ("YYYY-MM"). */
export async function getMonthlyFlow(tx: UserDb, userId: string, endMonth: string, months = 6, accountIds?: string[]): Promise<MonthFlow[]> {
  const [ey, em] = endMonth.split("-").map(Number);
  const start = monthPeriod(...(addMonths(`${endMonth}-01`, -(months - 1)).split("-").map(Number).slice(0, 2) as [number, number])).start;
  const end = monthPeriod(ey, em).end;
  const rows = await tx.$queryRaw<{ month: string; income: bigint; expense: bigint }[]>`
    select to_char(t.competence_date, 'YYYY-MM') as month,
      coalesce(sum(t.amount) filter (where t.amount > 0), 0)::bigint as income,
      coalesce(sum(-t.amount) filter (where t.amount < 0), 0)::bigint as expense
    from public.transactions t
    where t.user_id = ${userId}::uuid
      and t.competence_date between ${fromISODate(start)} and ${fromISODate(end)}
      and ${EFFECTIVE}
      ${accountFilter(accountIds)}
    group by 1
  `;
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return Array.from({ length: months }, (_, i) => {
    const month = addMonths(`${endMonth}-01`, i - (months - 1)).slice(0, 7);
    const row = byMonth.get(month);
    const income = BigInt(row?.income ?? 0);
    const expense = BigInt(row?.expense ?? 0);
    return { month, income, expense, result: income - expense };
  });
}

/** Soma dos saldos atuais das contas ativas (cartão entra negativo). */
export async function getAccountsBalance(tx: UserDb, userId: string): Promise<{ total: bigint; count: number }> {
  const [row] = await tx.$queryRaw<{ total: bigint; count: bigint }[]>`
    select coalesce(sum(a.current_balance), 0)::bigint as total, count(*)::bigint as count
    from public.accounts a
    where a.user_id = ${userId}::uuid and a.archived = false
  `;
  return { total: BigInt(row?.total ?? 0), count: Number(row?.count ?? 0) };
}

export const periodForMonth = (month: string): Period => {
  const [y, m] = month.split("-").map(Number);
  return monthPeriod(y, m);
};

export const previousMonth = (month: string): string => addMonths(`${month}-01`, -1).slice(0, 7);

export type { ISODate };
