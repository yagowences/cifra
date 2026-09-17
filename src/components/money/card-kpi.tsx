import Link from "next/link";
import type { ReactNode } from "react";
import { Valor } from "./valor";

type Props = {
  label: string;
  /** Centavos, ou um nó pronto (ex.: percentual). */
  value: bigint | ReactNode;
  tone?: "auto" | "neutral";
  /** Linha de contexto: variação (Variacao) ou texto em ink-secondary. */
  detail?: ReactNode;
  /** Todo KPI leva à lista que ele resume. */
  href: string;
};

/** Bloco compacto com rótulo, valor e variação. Sempre clicável. */
export function CardKPI({ label, value, tone = "auto", detail, href }: Props) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-border-subtle bg-surface-raised p-4 shadow-card transition-colors duration-150 hover:border-border-strong"
    >
      <span className="block text-micro text-ink-muted uppercase">{label}</span>
      <span className="mt-2 block">
        {typeof value === "bigint" ? <Valor cents={value} size="lg" tone={tone} decimals={false} /> : value}
      </span>
      {detail && <span className="mt-1 block text-caption text-ink-secondary">{detail}</span>}
    </Link>
  );
}

/** Estado de carregamento com as mesmas dimensões, sem animação de brilho. */
export function CardKPISkeleton({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-raised p-4">
      <span className="block text-micro text-ink-muted uppercase">{label}</span>
      <div className="mt-2 h-[26px] rounded-xs bg-surface-sunken" />
      <span className="mt-1 block text-caption text-ink-secondary">Calculando…</span>
    </div>
  );
}
