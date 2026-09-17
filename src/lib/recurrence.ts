/**
 * Subconjunto de RRULE (RFC 5545) suficiente para o Cifra:
 * FREQ=WEEKLY|MONTHLY|YEARLY, INTERVAL, COUNT, UNTIL. Sem BYDAY/BYMONTHDAY:
 * a ocorrência repete o dia da data inicial, com clamp no fim do mês.
 */
import { addDays, addMonths, isISODate, type ISODate } from "./dates";

export type Frequency = "WEEKLY" | "MONTHLY" | "YEARLY";

export type RecurrenceRule = {
  freq: Frequency;
  interval: number;
  count?: number;
  until?: ISODate;
};

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  WEEKLY: "Semanal",
  MONTHLY: "Mensal",
  YEARLY: "Anual",
};

export function parseRRule(text: string): RecurrenceRule {
  const parts = Object.fromEntries(
    text
      .replace(/^RRULE:/i, "")
      .split(";")
      .filter(Boolean)
      .map((p) => {
        const [k, v] = p.split("=");
        return [k.toUpperCase(), v ?? ""];
      }),
  );
  const freq = parts.FREQ as Frequency;
  if (!["WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) throw new Error(`RRULE sem FREQ válido: ${text}`);
  const interval = parts.INTERVAL ? Number(parts.INTERVAL) : 1;
  if (!Number.isInteger(interval) || interval < 1) throw new Error(`INTERVAL inválido: ${parts.INTERVAL}`);
  const rule: RecurrenceRule = { freq, interval };
  if (parts.COUNT) {
    const count = Number(parts.COUNT);
    if (!Number.isInteger(count) || count < 1) throw new Error(`COUNT inválido: ${parts.COUNT}`);
    rule.count = count;
  }
  if (parts.UNTIL) {
    const until = parts.UNTIL.length === 8 ? `${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}` : parts.UNTIL.slice(0, 10);
    if (!isISODate(until)) throw new Error(`UNTIL inválido: ${parts.UNTIL}`);
    rule.until = until;
  }
  return rule;
}

export function formatRRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  if (rule.until) parts.push(`UNTIL=${rule.until.replace(/-/g, "")}`);
  return parts.join(";");
}

/** N-ésima ocorrência (0 = a própria data inicial). */
export function nthOccurrence(start: ISODate, rule: RecurrenceRule, n: number): ISODate {
  const steps = n * rule.interval;
  switch (rule.freq) {
    case "WEEKLY":
      return addDays(start, steps * 7);
    case "MONTHLY":
      return addMonths(start, steps);
    case "YEARLY":
      return addMonths(start, steps * 12);
  }
}

/**
 * Ocorrências de `start` (inclusive) até `until` (inclusive), respeitando COUNT e UNTIL da regra.
 * `from` permite pular o que já foi gerado. Limitado a `max` para nunca gerar sem fim.
 */
export function occurrencesBetween(
  start: ISODate,
  rule: RecurrenceRule,
  range: { from?: ISODate; until: ISODate },
  max = 500,
): ISODate[] {
  const out: ISODate[] = [];
  const hardStop = rule.until && rule.until < range.until ? rule.until : range.until;
  for (let n = 0; n < max; n++) {
    if (rule.count !== undefined && n >= rule.count) break;
    const date = nthOccurrence(start, rule, n);
    if (date > hardStop) break;
    if (range.from && date < range.from) continue;
    out.push(date);
  }
  return out;
}

/** Primeira ocorrência estritamente depois de `after`, ou null se a regra acabou. */
export function nextOccurrenceAfter(start: ISODate, rule: RecurrenceRule, after: ISODate, max = 5000): ISODate | null {
  for (let n = 0; n < max; n++) {
    if (rule.count !== undefined && n >= rule.count) return null;
    const date = nthOccurrence(start, rule, n);
    if (rule.until && date > rule.until) return null;
    if (date > after) return date;
  }
  return null;
}
