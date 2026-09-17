"use client";

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { addMonths, formatMonthYear } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { AccountOption } from "./transaction-sheet-provider";

const TYPES = [
  { value: "", label: "Tudo" },
  { value: "EXPENSE", label: "Saídas" },
  { value: "INCOME", label: "Entradas" },
  { value: "TRANSFER", label: "Transferências" },
];

const chip = (active: boolean) =>
  cn(
    "h-9 shrink-0 rounded-sm px-3.5 text-caption font-medium whitespace-nowrap transition-colors duration-150",
    active ? "bg-brand text-on-brand" : "border border-border-strong text-ink-secondary hover:text-ink-primary",
  );

/** Filtros da lista vivem na URL: mês, conta, tipo e busca. Cada mudança re-renderiza no servidor. */
export function FiltroChips({ month, accounts }: { month: string; accounts: AccountOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [showSearch, setShowSearch] = useState(Boolean(params.get("q")));
  const [year, m] = month.split("-").map(Number);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("cursor");
    router.push(`${pathname}?${next.toString()}`);
  };

  const shiftMonth = (delta: number) => update({ mes: addMonths(`${month}-01`, delta).slice(0, 7) });

  return (
    <div className="flex flex-col gap-3 pb-4">
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Mês anterior" onClick={() => shiftMonth(-1)} className="flex size-11 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-sunken">
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        <span className="min-w-36 text-center text-micro text-ink-secondary uppercase">{formatMonthYear(year, m)}</span>
        <button type="button" aria-label="Próximo mês" onClick={() => shiftMonth(1)} className="flex size-11 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-sunken">
          <ChevronRight size={18} strokeWidth={2} />
        </button>
        <button
          type="button"
          aria-label="Buscar"
          aria-pressed={showSearch}
          onClick={() => {
            if (showSearch) update({ q: null });
            setShowSearch((s) => !s);
          }}
          className="ml-auto flex size-11 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-sunken"
        >
          {showSearch ? <X size={20} strokeWidth={1.75} /> : <Search size={20} strokeWidth={1.75} />}
        </button>
      </div>

      {showSearch && (
        <input
          type="search"
          autoFocus
          defaultValue={params.get("q") ?? ""}
          placeholder="Buscar por descrição"
          onKeyDown={(e) => e.key === "Enter" && update({ q: e.currentTarget.value.trim() || null })}
          onBlur={(e) => update({ q: e.currentTarget.value.trim() || null })}
          className="h-11 w-full rounded-md border border-border-strong bg-surface-sunken px-3 text-body text-ink-primary placeholder:text-ink-muted"
        />
      )}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0">
        <select
          aria-label="Conta"
          value={params.get("conta") ?? ""}
          onChange={(e) => update({ conta: e.target.value || null })}
          className={cn(chip(Boolean(params.get("conta"))), "appearance-none bg-transparent pr-3.5")}
        >
          <option value="">Todas as contas</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={(params.get("tipo") ?? "") === t.value}
            onClick={() => update({ tipo: t.value || null })}
            className={chip((params.get("tipo") ?? "") === t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
