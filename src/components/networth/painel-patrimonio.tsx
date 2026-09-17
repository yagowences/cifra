"use client";

import { Archive, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Botao } from "@/components/botao";
import { EvolucaoPatrimonio, type EvolucaoPoint } from "@/components/charts/evolucao-patrimonio";
import { Valor } from "@/components/money/valor";
import { Variacao } from "@/components/money/variacao";
import { assetClassLabel, type AssetListItem } from "@/lib/assets";
import { formatBRL, formatPercent } from "@/lib/money";
import { archiveAssetAction } from "@/server/actions/networth";
import { AssetSheet } from "./asset-sheet";

export type PatrimonioData = {
  net: string;
  assetsTotal: string;
  liabilitiesTotal: string;
  variation12m: number | null;
  byClass: { class: string; total: string; percent: number }[];
  liabilities: { id: string; name: string; class: string; value: string }[];
  history: EvolucaoPoint[];
  assets: AssetListItem[];
};

const SERIES = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"];

/** Ativos e passivos são blocos separados que se encontram no número líquido do topo. */
export function PainelPatrimonio({ data }: { data: PatrimonioData }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<{ open: boolean; asset: AssetListItem | null; liability: boolean }>({ open: false, asset: null, liability: false });
  const [pending, startTransition] = useTransition();

  const archive = (asset: AssetListItem) =>
    startTransition(async () => {
      const result = await archiveAssetAction(asset.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Arquivado");
      router.refresh();
    });

  const max = data.byClass.reduce((m, c) => (BigInt(c.total) > m ? BigInt(c.total) : m), 0n);
  const editable = (id: string) => data.assets.find((a) => a.id === id);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-micro text-ink-muted uppercase">Patrimônio líquido</p>
        <Valor cents={data.net} size="hero" tone="neutral" className="mt-1.5 block" />
        <Variacao percent={data.variation12m} suffix="em 12 meses" className="mt-1.5" />
      </div>

      <section className="rounded-lg border border-border-subtle bg-surface-raised p-4 shadow-card">
        <h2 className="pb-4 text-title">Evolução mensal</h2>
        <EvolucaoPatrimonio points={data.history} />
        <p className="pt-2 text-caption text-ink-secondary">Cada ponto é a foto do fim do mês; o mês atual acompanha o valor de hoje.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border-subtle bg-surface-raised p-4 shadow-card">
          <header className="flex items-baseline justify-between pb-4">
            <h2 className="text-title">Ativos</h2>
            <Valor cents={data.assetsTotal} tone="neutral" />
          </header>
          <ul className="flex flex-col gap-3">
            {data.byClass.map((c, i) => (
              <li key={c.class}>
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="text-body">{assetClassLabel(c.class)}</span>
                    <span className="ml-2 text-caption text-ink-secondary">{formatPercent(c.percent)}</span>
                  </span>
                  <span className="tabular shrink-0 text-amount-md">{formatBRL(BigInt(c.total), { symbol: false })}</span>
                </span>
                <span className="mt-2 block h-2 overflow-hidden rounded-xs bg-surface-sunken">
                  <span className="block h-full rounded-xs" style={{ width: `${max > 0n ? Number((BigInt(c.total) * 1000n) / max) / 10 : 0}%`, background: `var(--${SERIES[Math.min(i, 4)]})` }} />
                </span>
              </li>
            ))}
            {data.byClass.length === 0 && <li className="py-4 text-center text-body text-ink-secondary">Nenhum ativo ainda.</li>}
          </ul>
          <ul className="mt-4 flex flex-col divide-y divide-border-subtle border-t border-border-subtle">
            {data.assets
              .filter((a) => !a.isLiability)
              .map((a) => (
                <li key={a.id} className="flex h-14 items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body">{a.name}</span>
                    <span className="block text-caption text-ink-secondary">{assetClassLabel(a.class)}</span>
                  </span>
                  <Valor cents={a.currentValue} tone="neutral" />
                  <button type="button" aria-label={`Editar ${a.name}`} onClick={() => setSheet({ open: true, asset: a, liability: false })} className="flex size-11 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-sunken">
                    <Pencil size={18} strokeWidth={1.5} />
                  </button>
                  <button type="button" aria-label={`Arquivar ${a.name}`} disabled={pending} onClick={() => archive(a)} className="flex size-11 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-sunken">
                    <Archive size={18} strokeWidth={1.5} />
                  </button>
                </li>
              ))}
          </ul>
          <Botao variant="secundario" size="compacto" className="mt-4" onClick={() => setSheet({ open: true, asset: null, liability: false })}>
            <Plus strokeWidth={1.5} /> Ativo
          </Botao>
        </section>

        <section className="rounded-lg border border-border-subtle bg-surface-raised p-4 shadow-card">
          <header className="flex items-baseline justify-between pb-4">
            <h2 className="text-title">Dívidas</h2>
            <Valor cents={`-${data.liabilitiesTotal}`} sign />
          </header>
          <ul className="flex flex-col divide-y divide-border-subtle">
            {data.liabilities.map((l) => {
              const asset = editable(l.id);
              return (
                <li key={l.id} className="flex h-14 items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body">{l.name}</span>
                    <span className="block text-caption text-ink-secondary">{l.id === "cards" ? "Saldo devedor dos cartões" : assetClassLabel(l.class)}</span>
                  </span>
                  <Valor cents={`-${l.value}`} sign />
                  {asset && (
                    <>
                      <button type="button" aria-label={`Editar ${l.name}`} onClick={() => setSheet({ open: true, asset, liability: true })} className="flex size-11 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-sunken">
                        <Pencil size={18} strokeWidth={1.5} />
                      </button>
                      <button type="button" aria-label={`Arquivar ${l.name}`} disabled={pending} onClick={() => archive(asset)} className="flex size-11 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-sunken">
                        <Archive size={18} strokeWidth={1.5} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
            {data.liabilities.length === 0 && <li className="py-4 text-center text-body text-ink-secondary">Nenhuma dívida cadastrada.</li>}
          </ul>
          <Botao variant="secundario" size="compacto" className="mt-4" onClick={() => setSheet({ open: true, asset: null, liability: true })}>
            <Plus strokeWidth={1.5} /> Dívida
          </Botao>
        </section>
      </div>

      <AssetSheet open={sheet.open} asset={sheet.asset} liability={sheet.liability} onClose={() => setSheet((s) => ({ ...s, open: false }))} />
    </div>
  );
}
