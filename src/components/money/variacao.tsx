import { ArrowDown, ArrowUp } from "lucide-react";
import { formatPercent } from "@/lib/money";
import { cn } from "@/lib/utils";

type Props = {
  /** Variação percentual; null quando não há base de comparação. */
  percent: number | null;
  /** Se subir é bom (resultado, entradas) ou ruim (saídas). Define a cor. */
  upIsGood?: boolean;
  /** Texto após o número, ex.: "vs. agosto". */
  suffix?: string;
  className?: string;
};

/** Variação percentual sempre com seta, porque cor sozinha não é acessível. */
export function Variacao({ percent, upIsGood = true, suffix, className }: Props) {
  if (percent === null) {
    return <span className={cn("text-caption text-ink-secondary", className)}>sem base de comparação</span>;
  }
  const up = percent > 0;
  const flat = percent === 0;
  const good = flat ? null : up === upIsGood;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-caption font-medium",
        good === null ? "text-ink-secondary" : good ? "text-positive" : "text-negative",
        className,
      )}
    >
      {!flat && <Icon size={12} strokeWidth={2.5} aria-hidden />}
      <span>
        {flat ? "0%" : formatPercent(Math.abs(percent))}
        {suffix ? ` ${suffix}` : ""}
      </span>
      <span className="sr-only">{up ? "subiu" : flat ? "estável" : "caiu"}</span>
    </span>
  );
}
