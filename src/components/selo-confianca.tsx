import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type ConfidenceLevel = "alta" | "media" | "baixa";

/** Faixas do Design System: alta ≥ 0,90; média 0,80–0,89; baixa < 0,80. */
export const confidenceLevel = (value: number): ConfidenceLevel => (value >= 0.9 ? "alta" : value >= 0.8 ? "media" : "baixa");

/**
 * Mostra o quanto a IA confia num campo extraído. Nunca 100%: confiança
 * absoluta não existe. No estado baixo, o campo ganha borda warning e o texto
 * "Confira este campo".
 */
export function SeloConfianca({ value, className }: { value: number; className?: string }) {
  const level = confidenceLevel(value);
  const percent = Math.min(99, Math.round(value * 100));
  return (
    <span
      className={cn(
        "tabular inline-flex h-6 items-center gap-1 rounded-xs px-1.5 text-micro uppercase",
        level === "alta" && "text-positive",
        level === "media" && "text-ink-secondary",
        level === "baixa" && "bg-warning-soft text-warning",
        className,
      )}
      title={level === "baixa" ? "Confira este campo" : undefined}
    >
      {level === "alta" && <Check size={12} strokeWidth={2.5} aria-hidden />}
      {percent}%{level === "baixa" && <span className="normal-case tracking-normal"> · Confira</span>}
    </span>
  );
}
