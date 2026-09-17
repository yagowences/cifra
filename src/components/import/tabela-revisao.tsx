"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Botao } from "@/components/botao";
import { Valor } from "@/components/money/valor";
import { NativeSelect } from "@/components/form";
import type { CategoryOption } from "@/components/transactions/transaction-sheet-provider";
import { formatShortDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { confirmImportAction } from "@/server/actions/import";
import type { ReviewRow, RowStatus } from "@/server/services/import/types";

type Filter = RowStatus | "all";

const STATUS_LABEL: Record<RowStatus, string> = {
  new: "Novas",
  possible_duplicate: "Possíveis duplicatas",
  matched: "Casadas",
  duplicate: "Duplicatas",
};

type Props = { batchId: string; rows: ReviewRow[]; categories: CategoryOption[]; month: string };

/**
 * Tabela de revisão: novas e casadas vêm marcadas; possível duplicata pede
 * decisão; duplicata exata não pode ser marcada. Linha sem categoria
 * sugerida fica destacada em warning até a pessoa escolher (ou aceitar sem).
 */
export function TabelaRevisao({ batchId, rows, categories, month }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(rows.filter((r) => r.status === "new" || r.status === "matched").map((r) => r.key)));
  const [categoryOf, setCategoryOf] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.filter((r) => r.suggestedCategoryId).map((r) => [r.key, r.suggestedCategoryId!])),
  );
  const [pending, startTransition] = useTransition();

  const counts = useMemo(() => {
    const c: Record<RowStatus, number> = { new: 0, possible_duplicate: 0, matched: 0, duplicate: 0 };
    rows.forEach((r) => c[r.status]++);
    return c;
  }, [rows]);

  const visible = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const selectable = rows.filter((r) => r.status !== "duplicate");
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.key));
  const undecided = rows.filter((r) => selected.has(r.key) && !categoryOf[r.key]).length;

  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const confirm = () => {
    startTransition(async () => {
      const accepted = rows.filter((r) => selected.has(r.key)).map((r) => ({ key: r.key, categoryId: categoryOf[r.key] ?? null }));
      const result = await confirmImportAction({ batchId, accepted });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`${rows.length} lidos · ${result.data.created} novos · ${counts.duplicate} duplicados`);
      router.push(`/transacoes?mes=${month}`);
      router.refresh();
    });
  };

  const categoriesFor = (row: ReviewRow) => categories.filter((c) => c.type === (BigInt(row.amount) >= 0n ? "INCOME" : "EXPENSE"));

  return (
    <div className="flex flex-col gap-4">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:px-0">
        {(["all", "new", "possible_duplicate", "matched", "duplicate"] as Filter[]).map((f) => {
          const n = f === "all" ? rows.length : counts[f];
          if (f !== "all" && n === 0) return null;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "h-9 shrink-0 rounded-sm px-3.5 text-caption font-medium whitespace-nowrap transition-colors duration-150",
                filter === f ? "bg-brand text-on-brand" : "border border-border-strong text-ink-secondary hover:text-ink-primary",
              )}
            >
              {f === "all" ? "Todas" : STATUS_LABEL[f]} · {n}
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-raised">
        <div className="hidden h-11 items-center gap-3 border-b border-border-subtle px-4 text-micro text-ink-muted uppercase lg:grid lg:grid-cols-[28px_64px_minmax(0,1fr)_104px_168px_88px]">
          <input
            type="checkbox"
            aria-label="Selecionar todas"
            checked={allSelected}
            onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.key)) : new Set())}
            className="size-4 accent-brand"
          />
          <span>Data</span>
          <span>Descrição</span>
          <span className="text-right">Valor</span>
          <span>Categoria</span>
          <span className="text-right">Situação</span>
        </div>

        {visible.length === 0 && <p className="px-4 py-8 text-center text-body text-ink-secondary">Nada nesta situação.</p>}

        {visible.map((row) => {
          const isDup = row.status === "duplicate";
          const checked = selected.has(row.key);
          const needsCategory = checked && !categoryOf[row.key] && row.status !== "matched";
          return (
            <div
              key={row.key}
              data-testid="linha-revisao"
              className={cn(
                "grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-border-subtle px-4 py-3 last:border-b-0 lg:min-h-[58px] lg:grid-cols-[28px_64px_minmax(0,1fr)_104px_168px_88px] lg:py-2",
                needsCategory && "bg-warning-soft",
                isDup && "opacity-60",
              )}
            >
              <input
                type="checkbox"
                aria-label={`Selecionar ${row.description}`}
                checked={checked}
                disabled={isDup}
                onChange={() => toggle(row.key)}
                className="size-4 accent-brand"
              />
              <span className="tabular hidden text-caption text-ink-secondary lg:block">{formatShortDate(row.date).slice(0, 5)}</span>
              <span className="min-w-0">
                <span className="block truncate text-body">{row.description}</span>
                <span className="block truncate text-caption text-ink-secondary">
                  <span className="tabular lg:hidden">{formatShortDate(row.date).slice(0, 5)} · </span>
                  {row.matchReason ?? row.memo ?? ""}
                </span>
              </span>
              <Valor cents={row.amount} sign symbol={false} className="text-right" />
              <span className="col-span-2 col-start-2 lg:col-span-1 lg:col-start-auto">
                {row.status === "matched" ? (
                  <span className="text-caption text-ink-secondary">Mantém a categoria da previsão</span>
                ) : (
                  <NativeSelect
                    aria-label={`Categoria de ${row.description}`}
                    value={categoryOf[row.key] ?? ""}
                    disabled={isDup}
                    onChange={(e) => setCategoryOf((c) => ({ ...c, [row.key]: e.target.value }))}
                    className={cn("h-9 text-caption", needsCategory && "border-warning")}
                  >
                    <option value="">{needsCategory ? "Escolher categoria" : "Sem categoria"}</option>
                    {categoriesFor(row).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </span>
              <span className={cn("hidden text-right text-caption lg:block", row.status === "new" ? "text-ink-secondary" : row.status === "duplicate" ? "text-ink-muted" : "text-warning")}>
                {row.confidence !== null && row.status === "new" ? `${Math.round(row.confidence * 100)}%` : STATUS_LABEL[row.status].replace("Possíveis duplicatas", "Possível duplicata").replace("Casadas", "Casada").replace("Duplicatas", "Duplicata")}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <p className="tabular text-caption text-ink-secondary">
          {selected.size} {selected.size === 1 ? "selecionada" : "selecionadas"}
          {undecided > 0 && ` · ${undecided} sem categoria`}
        </p>
        <Botao variant="primario" onClick={confirm} carregando={pending} disabled={selected.size === 0} className="w-full lg:w-auto">
          Importar {selected.size} {selected.size === 1 ? "lançamento" : "lançamentos"}
        </Botao>
      </div>
    </div>
  );
}
