/**
 * Dinheiro no Cifra é bigint em centavos. Este módulo é o único lugar que
 * formata ou interpreta valores: um valor formatado fora daqui é bug.
 */

/** Sinal menos tipográfico (U+2212). Nunca o hífen. */
export const MINUS = "−";
const NBSP = " ";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlNoCents = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export type FormatOptions = {
  /** Prefixa + ou − conforme o sinal. Zero não recebe sinal. */
  sign?: boolean;
  /** Omite "R$": só para o segundo nível de uma tela (linha de lista, tabela). */
  symbol?: boolean;
  /** Omite os centavos: KPI e número herói de dashboard. Arredonda para o real mais próximo. */
  decimals?: boolean;
};

const abs = (cents: bigint) => (cents < 0n ? -cents : cents);

/** `formatBRL(184000n)` → "R$ 1.840,00"; com `sign` → "+ R$ 1.840,00" / "− R$ 48,90". */
export function formatBRL(cents: bigint, opts: FormatOptions = {}): string {
  const { sign = false, symbol = true, decimals: withCents = true } = opts;
  const magnitude = abs(cents);
  const reais = withCents ? Number(magnitude) / 100 : Number(roundToReais(magnitude));
  let out = (withCents ? brl : brlNoCents).format(reais);
  if (!symbol) out = out.replace(/^R\$\s?/, "");
  if (sign && cents !== 0n) out = `${cents < 0n ? MINUS : "+"}${NBSP}${out}`;
  return out;
}

/** Arredonda centavos para reais inteiros (meio para cima), mantendo bigint. */
function roundToReais(magnitude: bigint): bigint {
  return (magnitude + 50n) / 100n;
}

/**
 * Interpreta entrada humana em reais: "1.840,00", "R$ 48,90", "1840", "-48,90", "−48,90", "48.9".
 * Devolve centavos ou null se não for um número. Sem sinal, o valor é positivo;
 * o chamador aplica o sinal do tipo com `signedAmount`.
 */
export function parseBRL(input: string): bigint | null {
  let s = input.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!s) return null;

  let negative = false;
  if (s.startsWith("-") || s.startsWith(MINUS)) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }

  // Decide o separador decimal: o último entre "," e "." se ele for seguido de 1–2 dígitos.
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const decimalPos = Math.max(lastComma, lastDot);
  let intPart = s;
  let fracPart = "";
  if (decimalPos >= 0 && /^\d{1,2}$/.test(s.slice(decimalPos + 1))) {
    intPart = s.slice(0, decimalPos);
    fracPart = s.slice(decimalPos + 1);
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (!/^\d*$/.test(intPart) || (intPart === "" && fracPart === "")) return null;

  const cents = BigInt(intPart || "0") * 100n + BigInt(fracPart.padEnd(2, "0"));
  return negative ? -cents : cents;
}

export type AmountKind = "INCOME" | "EXPENSE" | "TRANSFER";

/** Aplica o sinal do banco a uma magnitude: receita > 0; despesa e transferência < 0. */
export function signedAmount(kind: AmountKind, magnitude: bigint): bigint {
  const m = abs(magnitude);
  return kind === "INCOME" ? m : -m;
}

/**
 * Divide um total em `parts` parcelas inteiras cuja soma é exatamente o total.
 * O resto (centavos que não dividem) vai para as primeiras parcelas.
 */
export function splitEvenly(total: bigint, parts: number): bigint[] {
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError("parts deve ser inteiro ≥ 1");
  const n = BigInt(parts);
  const sign = total < 0n ? -1n : 1n;
  const magnitude = abs(total);
  const base = magnitude / n;
  const remainder = Number(magnitude % n);
  return Array.from({ length: parts }, (_, i) => sign * (base + (i < remainder ? 1n : 0n)));
}

export const sumCents = (values: Iterable<bigint>): bigint => {
  let total = 0n;
  for (const v of values) total += v;
  return total;
};

/** Percentual de `part` sobre `total` com uma casa decimal; 0 quando o total é zero. */
export function percentOf(part: bigint, total: bigint): number {
  if (total === 0n) return 0;
  const t = abs(total);
  return Number((abs(part) * 1000n + t / 2n) / t) / 10;
}

/** Variação de `previous` para `current` em %, arredondada ao inteiro; null quando não há base. */
export function percentChange(previous: bigint, current: bigint): number | null {
  if (previous === 0n) return null;
  return Number(((current - previous) * 100n) / abs(previous));
}

/** "18%", ou com `sign`: "+18%" / "−18%". */
export function formatPercent(value: number, opts: { sign?: boolean } = {}): string {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  const text = `${Math.abs(rounded).toLocaleString("pt-BR")}%`;
  if (!opts.sign || rounded === 0) return text;
  return `${rounded < 0 ? MINUS : "+"}${text}`;
}
