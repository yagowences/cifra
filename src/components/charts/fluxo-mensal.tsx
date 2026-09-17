"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { formatBRL } from "@/lib/money";

export type FluxoPoint = {
  /** "YYYY-MM" */
  month: string;
  /** Centavos como string (bigint não atravessa a fronteira do cliente). */
  income: string;
  expense: string;
  result: string;
};

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const label = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1];

/** Eixo em reais inteiros, compacto acima de mil: 1,2 mil. */
const tick = (v: number) => {
  const abs = Math.abs(v);
  const text = abs >= 1000 ? `${(abs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : abs.toLocaleString("pt-BR");
  return v < 0 ? `−${text}` : text;
};

type Row = { month: string; result: number; income: bigint; expense: bigint; resultCents: bigint };

type ShapeProps = { x?: number; y?: number; width?: number; height?: number; value?: number; fill?: string };

/** Coluna com 4px arredondados só na ponta do dado; quadrada na linha do zero. */
function RoundedBar({ x = 0, y: rawY = 0, width = 0, height: rawHeight = 0, value = 0, fill }: ShapeProps) {
  // Para valor negativo o Recharts entrega altura negativa a partir da linha do zero.
  const height = Math.abs(rawHeight);
  const y = rawHeight < 0 ? rawY + rawHeight : rawY;
  if (height <= 0 || width <= 0) return null;
  const r = Math.min(4, width / 2, height);
  const negative = value < 0;
  const d = negative
    ? `M${x},${y} h${width} v${height - r} a${r},${r} 0 0 1 -${r},${r} h-${width - 2 * r} a${r},${r} 0 0 1 -${r},-${r} Z`
    : `M${x},${y + r} a${r},${r} 0 0 1 ${r},-${r} h${width - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${height - r} h-${width} Z`;
  return <path d={d} fill={fill} />;
}

function FluxoTooltip({ active, payload }: TooltipProps<number, string>) {
  const row = payload?.[0]?.payload as Row | undefined;
  if (!active || !row) return null;
  return (
    <div className="rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-caption shadow-card">
      <p className="text-micro text-ink-muted uppercase">{label(row.month)}</p>
      <p className="tabular text-ink-primary">Resultado {formatBRL(row.resultCents, { sign: true })}</p>
      <p className="tabular text-ink-secondary">Entradas {formatBRL(row.income)}</p>
      <p className="tabular text-ink-secondary">Saídas {formatBRL(row.expense)}</p>
    </div>
  );
}

/**
 * Resultado mensal (entradas − saídas) em colunas: acima do zero em positive,
 * abaixo em negative. Série única, sem legenda: o título nomeia o que está no gráfico.
 * Sem animação: a interpolação do Recharts entrega props parciais à forma customizada.
 */
export function FluxoMensal({ points }: { points: FluxoPoint[] }) {
  const rows: Row[] = points.map((p) => ({
    month: p.month,
    result: Number(BigInt(p.result)) / 100,
    resultCents: BigInt(p.result),
    income: BigInt(p.income),
    expense: BigInt(p.expense),
  }));
  return (
    <figure>
      <div className="h-44 w-full" role="img" aria-label="Resultado por mês nos últimos seis meses">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="30%">
            <XAxis dataKey="month" tickFormatter={label} axisLine={false} tickLine={false} tick={{ fill: "var(--ink-secondary)", fontSize: 11 }} />
            <YAxis
              tickFormatter={tick}
              axisLine={false}
              tickLine={false}
              width={56}
              tick={{ fill: "var(--ink-muted)", fontSize: 11, className: "tabular" }}
            />
            <Tooltip content={<FluxoTooltip />} cursor={{ fill: "var(--surface-sunken)" }} />
            <Bar dataKey="result" maxBarSize={24} shape={<RoundedBar />} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.month} fill={r.result < 0 ? "var(--negative)" : "var(--positive)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        {rows.map((r) => `${label(r.month)}: ${formatBRL(r.resultCents, { sign: true })}`).join("; ")}
      </figcaption>
    </figure>
  );
}
