import { addMonths, type ISODate } from "./dates";
import { percentOf } from "./money";

export type GoalProgressInput = {
  targetAmount: bigint;
  currentAmount: bigint;
  deadline: ISODate | null;
  /** Aporte médio mensal observado (centavos); null quando não há histórico. */
  monthlyPace: bigint | null;
  today: ISODate;
};

export type GoalProgress = {
  percent: number;
  remaining: bigint;
  reached: boolean;
  /** Meses no ritmo atual até bater a meta; null sem ritmo. */
  monthsToGo: number | null;
  /** Mês previsto de conclusão ("YYYY-MM"); null sem ritmo. */
  forecastMonth: string | null;
  /** Aporte mensal necessário para chegar no prazo; null sem prazo ou prazo vencido. */
  neededPerMonth: bigint | null;
  onTrack: boolean | null;
};

const monthsBetween = (from: ISODate, to: ISODate) => {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
};

/** Progresso com previsão, não só barra. Nunca inventa ritmo: sem histórico, sem previsão. */
export function goalProgress(input: GoalProgressInput): GoalProgress {
  const remaining = input.targetAmount > input.currentAmount ? input.targetAmount - input.currentAmount : 0n;
  const reached = remaining === 0n;
  const percent = Math.min(100, percentOf(input.currentAmount, input.targetAmount));

  let monthsToGo: number | null = null;
  let forecastMonth: string | null = null;
  if (reached) {
    monthsToGo = 0;
    forecastMonth = input.today.slice(0, 7);
  } else if (input.monthlyPace !== null && input.monthlyPace > 0n) {
    monthsToGo = Number((remaining + input.monthlyPace - 1n) / input.monthlyPace);
    forecastMonth = addMonths(`${input.today.slice(0, 7)}-01`, monthsToGo).slice(0, 7);
  }

  let neededPerMonth: bigint | null = null;
  let onTrack: boolean | null = null;
  if (input.deadline && !reached) {
    const months = Math.max(0, monthsBetween(input.today, input.deadline));
    neededPerMonth = months > 0 ? (remaining + BigInt(months) - 1n) / BigInt(months) : remaining;
    if (input.monthlyPace !== null) onTrack = input.monthlyPace >= neededPerMonth;
  }

  return { percent, remaining, reached, monthsToGo, forecastMonth, neededPerMonth, onTrack };
}
