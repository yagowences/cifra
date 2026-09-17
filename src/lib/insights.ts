/**
 * Detectores determinísticos. Nenhum número aqui vem de modelo: tudo é
 * calculado sobre transações e só depois vira texto.
 */
import { addMonths, type ISODate } from "./dates";
import { formatBRL, formatPercent } from "./money";

export type MerchantRow = { merchantKey: string; description: string; date: ISODate; amount: bigint; categoryName: string | null };

export type Subscription = {
  merchantKey: string;
  description: string;
  /** Valor típico (mediana) em centavos, positivo. */
  amount: bigint;
  cadence: "monthly" | "yearly";
  occurrences: number;
  lastDate: ISODate;
  categoryName: string | null;
};

const median = (values: bigint[]) => {
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return s[Math.floor(s.length / 2)];
};

const monthsApart = (a: ISODate, b: ISODate) => {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
};

/**
 * Assinatura: mesmo comerciante, valor estável (±5% da mediana), cadência mensal
 * (ou anual) e 3+ ocorrências. Ocorrências fora da tolerância de valor não contam.
 */
export function detectSubscriptions(rows: MerchantRow[]): Subscription[] {
  const groups = new Map<string, MerchantRow[]>();
  for (const r of rows) {
    if (r.amount >= 0n) continue;
    const list = groups.get(r.merchantKey) ?? [];
    list.push(r);
    groups.set(r.merchantKey, list);
  }
  const out: Subscription[] = [];
  for (const [merchantKey, list] of groups) {
    if (list.length < 3) continue;
    const magnitudes = list.map((r) => -r.amount);
    const typical = median(magnitudes);
    const tolerance = (typical * 5n) / 100n;
    const stable = list.filter((r) => {
      const m = -r.amount;
      return m >= typical - tolerance && m <= typical + tolerance;
    }).sort((a, b) => a.date.localeCompare(b.date));
    if (stable.length < 3) continue;

    const gaps = stable.slice(1).map((r, i) => monthsApart(stable[i].date, r.date));
    const monthly = gaps.every((g) => g === 1);
    const yearly = gaps.every((g) => g === 12);
    if (!monthly && !yearly) continue;

    out.push({
      merchantKey,
      description: stable[stable.length - 1].description,
      amount: typical,
      cadence: monthly ? "monthly" : "yearly",
      occurrences: stable.length,
      lastDate: stable[stable.length - 1].date,
      categoryName: stable[stable.length - 1].categoryName,
    });
  }
  return out.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
}

export type CategoryHistory = { categoryId: string | null; name: string; current: bigint; previous: bigint[] };

export type CategorySpike = { categoryId: string | null; name: string; current: bigint; mean: bigint; zScore: number; percentUp: number };

/** Aumento incomum: gasto do mês acima de 2σ da média dos 6 meses anteriores (mínimo 3 meses com dado). */
export function detectCategorySpikes(history: CategoryHistory[], sigma = 2): CategorySpike[] {
  const out: CategorySpike[] = [];
  for (const h of history) {
    const prev = h.previous.map(Number);
    if (prev.length < 3) continue;
    const mean = prev.reduce((s, v) => s + v, 0) / prev.length;
    const variance = prev.reduce((s, v) => s + (v - mean) ** 2, 0) / prev.length;
    const sd = Math.sqrt(variance);
    const current = Number(h.current);
    if (mean <= 0 || current <= mean) continue;
    // Sem variação histórica, qualquer aumento acima de 20% já é incomum.
    const z = sd > 0 ? (current - mean) / sd : current > mean * 1.2 ? Infinity : 0;
    if (z < sigma) continue;
    const meanCents = BigInt(Math.round(mean));
    out.push({
      categoryId: h.categoryId,
      name: h.name,
      current: h.current,
      mean: meanCents,
      zScore: Number.isFinite(z) ? Math.round(z * 10) / 10 : 99,
      percentUp: Math.round(((current - mean) / mean) * 100),
    });
  }
  return out.sort((a, b) => b.percentUp - a.percentUp);
}

export type DailyPace = { averageDaily: bigint; typicalDaily: bigint; percentUp: number; daysLeft: number } | null;

/** Gasto médio diário do mês acima do padrão (média diária dos 3 meses anteriores) em 20% ou mais, com pelo menos 7 dias corridos. */
export function detectDailyPace(input: { monthExpense: bigint; daysElapsed: number; daysInMonth: number; previousMonthsExpense: bigint[]; previousMonthsDays: number[] }): DailyPace {
  if (input.daysElapsed < 7 || input.previousMonthsExpense.length < 2) return null;
  const totalPrev = input.previousMonthsExpense.reduce((s, v) => s + v, 0n);
  const totalDays = input.previousMonthsDays.reduce((s, v) => s + v, 0);
  if (totalDays === 0 || totalPrev <= 0n) return null;
  const typicalDaily = totalPrev / BigInt(totalDays);
  const averageDaily = input.monthExpense / BigInt(input.daysElapsed);
  if (typicalDaily === 0n || averageDaily <= typicalDaily) return null;
  const percentUp = Number(((averageDaily - typicalDaily) * 100n) / typicalDaily);
  if (percentUp < 20) return null;
  return { averageDaily, typicalDaily, percentUp, daysLeft: input.daysInMonth - input.daysElapsed };
}

/** Texto do insight: número antes de adjetivo, segunda pessoa, sem julgamento. */
export function spikeText(s: CategorySpike, monthName: string): { title: string; body: string } {
  return {
    title: `${s.name} subiu ${formatPercent(s.percentUp)}`,
    body: `${formatBRL(s.current)} em ${monthName} contra média de ${formatBRL(s.mean)} nos meses anteriores.`,
  };
}

export function subscriptionsText(subs: Subscription[]): { title: string; body: string } {
  const monthly = subs.filter((s) => s.cadence === "monthly");
  const total = monthly.reduce((s, x) => s + x.amount, 0n);
  const names = monthly.slice(0, 3).map((s) => s.description).join(", ");
  return {
    title: `${monthly.length} ${monthly.length === 1 ? "assinatura ativa soma" : "assinaturas ativas somam"} ${formatBRL(total)}/mês`,
    body: monthly.length > 3 ? `${names} e mais ${monthly.length - 3}.` : `${names}.`,
  };
}

export function dailyPaceText(p: NonNullable<DailyPace>): { title: string; body: string } {
  return {
    title: `Seu gasto médio diário está ${formatPercent(p.percentUp)} acima do habitual`,
    body: `${formatBRL(p.averageDaily)} por dia contra ${formatBRL(p.typicalDaily)} nos meses anteriores — faltam ${p.daysLeft} ${p.daysLeft === 1 ? "dia" : "dias"} no mês.`,
  };
}

/** Meses anteriores a `month` ("YYYY-MM"), mais antigo primeiro. */
export const previousMonths = (month: string, n: number) => Array.from({ length: n }, (_, i) => addMonths(`${month}-01`, i - n).slice(0, 7));
