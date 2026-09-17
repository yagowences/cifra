import { formatBRL, type FormatOptions } from "@/lib/money";
import { cn } from "@/lib/utils";

type ValorProps = FormatOptions & {
  cents: bigint | string;
  size?: "hero" | "lg" | "md";
  /** "auto" colore pelo sinal (positive/negative); "neutral" mantém ink-primary (saldo). */
  tone?: "auto" | "neutral";
  className?: string;
};

const sizes = { hero: "text-amount-hero", lg: "text-amount-lg", md: "text-amount-md" };

/**
 * Exibe uma quantia em reais com numerais tabulares, sinal tipográfico e cor semântica.
 * Recebe centavos (bigint ou string decimal); nunca uma string já formatada.
 */
export function Valor({ cents, size = "md", tone = "auto", className, ...format }: ValorProps) {
  const value = typeof cents === "string" ? BigInt(cents) : cents;
  const color =
    tone === "neutral" || value === 0n ? "text-ink-primary" : value < 0n ? "text-negative" : "text-positive";
  return (
    <span className={cn("tabular", sizes[size], color, className)}>{formatBRL(value, format)}</span>
  );
}
