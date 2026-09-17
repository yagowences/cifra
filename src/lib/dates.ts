/**
 * Datas de calendário no Cifra circulam como ISO "YYYY-MM-DD" (sem hora, sem fuso).
 * Competência é quando o gasto aconteceu; caixa é quando o dinheiro saiu.
 * Relatório usa competência salvo quando o nome do relatório disser caixa.
 */

export type ISODate = string;

export const APP_TIMEZONE = "America/Sao_Paulo";

const pad = (n: number) => String(n).padStart(2, "0");

/** Converte um Date (ex.: coluna @db.Date do Prisma, em UTC) para "YYYY-MM-DD". */
export function toISODate(date: Date): ISODate {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Converte "YYYY-MM-DD" para o Date que o Prisma espera numa coluna @db.Date (meia-noite UTC). */
export function fromISODate(iso: ISODate): Date {
  const { year, month, day } = parts(iso);
  return new Date(Date.UTC(year, month - 1, day));
}

export function isISODate(value: string): value is ISODate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parts(value);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function parts(iso: ISODate) {
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y, month: m, day: d };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Hoje no fuso do app, como ISO. `now` é injetável para testes. */
export function todayISO(now: Date = new Date(), timeZone = APP_TIMEZONE): ISODate {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(now);
}

/** Soma meses mantendo o dia, com clamp no fim do mês: 31/jan + 1 → 28/fev. */
export function addMonths(iso: ISODate, months: number): ISODate {
  const { year, month, day } = parts(iso);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${pad(m)}-${pad(Math.min(day, daysInMonth(y, m)))}`;
}

export function addDays(iso: ISODate, days: number): ISODate {
  const d = fromISODate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

export type Period = { start: ISODate; end: ISODate };

/** Primeiro e último dia do mês (inclusivos). */
export function monthPeriod(year: number, month: number): Period {
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(daysInMonth(year, month))}` };
}

export function periodOf(iso: ISODate): Period {
  const { year, month } = parts(iso);
  return monthPeriod(year, month);
}

/**
 * Data de caixa de uma compra no cartão: a fatura fecha em `closingDay`; compras
 * depois do fechamento vão para a fatura seguinte; o pagamento cai em `dueDay`,
 * no mês do fechamento se `dueDay > closingDay`, senão no mês seguinte.
 * Ex.: fecha dia 3, vence dia 10 → compra em 28/jan tem caixa em 10/fev.
 */
export function cardCashDate(competence: ISODate, closingDay: number, dueDay: number): ISODate {
  const { year, month, day } = parts(competence);
  let closingMonth = `${year}-${pad(month)}-01`;
  if (day > closingDay) closingMonth = addMonths(closingMonth, 1);
  const dueMonth = dueDay > closingDay ? closingMonth : addMonths(closingMonth, 1);
  const { year: dy, month: dm } = parts(dueMonth);
  return `${dy}-${pad(dm)}-${pad(Math.min(dueDay, daysInMonth(dy, dm)))}`;
}

const MONTHS_SHORT = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const WEEKDAYS_SHORT = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
const MONTHS_LONG = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "17/09/2026" */
export function formatShortDate(iso: ISODate): string {
  const { year, month, day } = parts(iso);
  return `${pad(day)}/${pad(month)}/${year}`;
}

/** Cabeçalho de grupo de dia, em caixa alta: "HOJE · 17 SET", "ONTEM · 16 SET", "QUA · 15 SET". */
export function formatDayHeader(iso: ISODate, today: ISODate): string {
  const { month, day } = parts(iso);
  const dayMonth = `${day} ${MONTHS_SHORT[month - 1]}`;
  if (iso === today) return `HOJE · ${dayMonth}`;
  if (iso === addDays(today, -1)) return `ONTEM · ${dayMonth}`;
  const weekday = WEEKDAYS_SHORT[fromISODate(iso).getUTCDay()];
  const { year } = parts(iso);
  const suffix = year === parts(today).year ? "" : ` ${year}`;
  return `${weekday} · ${dayMonth}${suffix}`;
}

/** "Setembro 2026" */
export function formatMonthYear(year: number, month: number): string {
  const name = MONTHS_LONG[month - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}
