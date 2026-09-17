"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { formatBRL } from "@/lib/money";

/** `net` nulo = sem foto naquele mês: a linha começa na primeira foto. */
export type EvolucaoPoint = { month: string; net: string | null };

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const label = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]}${month.slice(5, 7) === "01" ? `/${month.slice(2, 4)}` : ""}`;

const tick = (v: number) => {
  const abs = Math.abs(v);
  const text = abs >= 1_000_000 ? `${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : abs >= 1000 ? `${(abs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil` : abs.toLocaleString("pt-BR");
  return v < 0 ? `−${text}` : text;
};

type Row = { month: string; net: number | null; netCents: bigint | null };

function EvolucaoTooltip({ active, payload }: TooltipProps<number, string>) {
  const row = payload?.[0]?.payload as Row | undefined;
  if (!active || !row || row.netCents === null) return null;
  return (
    <div className="rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-caption shadow-card">
      <p className="text-micro text-ink-muted uppercase">{label(row.month)}</p>
      <p className="tabular text-ink-primary">{formatBRL(row.netCents)}</p>
    </div>
  );
}

/** Patrimônio líquido mês a mês, lido dos snapshots. Linha de 2px, marcadores de 8px, sem área. */
export function EvolucaoPatrimonio({ points }: { points: EvolucaoPoint[] }) {
  const rows: Row[] = points.map((p) => ({ month: p.month, net: p.net === null ? null : Number(BigInt(p.net)) / 100, netCents: p.net === null ? null : BigInt(p.net) }));
  return (
    <figure>
      <div className="h-52 w-full" role="img" aria-label="Evolução do patrimônio líquido nos últimos doze meses">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="month" tickFormatter={label} axisLine={false} tickLine={false} tick={{ fill: "var(--ink-secondary)", fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tickFormatter={tick} axisLine={false} tickLine={false} width={56} tick={{ fill: "var(--ink-muted)", fontSize: 11, className: "tabular" }} domain={["auto", "auto"]} />
            <Tooltip content={<EvolucaoTooltip />} cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }} />
            <Line
              type="monotone"
              dataKey="net"
              stroke="var(--brand)"
              strokeWidth={2}
              dot={{ r: 4, fill: "var(--brand)", stroke: "var(--surface-raised)", strokeWidth: 2 }}
              activeDot={{ r: 5, fill: "var(--brand)", stroke: "var(--surface-raised)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{rows.filter((r) => r.netCents !== null).map((r) => `${label(r.month)}: ${formatBRL(r.netCents!)}`).join("; ")}</figcaption>
    </figure>
  );
}
