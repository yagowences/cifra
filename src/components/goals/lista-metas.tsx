"use client";

import { Pencil, Plus, Target } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Botao } from "@/components/botao";
import { EmptyState } from "@/components/empty-state";
import { Valor } from "@/components/money/valor";
import type { AccountOption } from "@/components/transactions/transaction-sheet-provider";
import { formatShortDate } from "@/lib/dates";
import { formatBRL, formatPercent, parseBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { contributeToGoalAction, setGoalStatusAction } from "@/server/actions/goals";
import { GoalSheet } from "./goal-sheet";

export type GoalListItem = {
  id: string;
  name: string;
  type: string;
  status: string;
  targetAmount: string;
  currentAmount: string;
  deadline: string | null;
  accountId: string | null;
  accountName: string | null;
  monthlyPace: string | null;
  progress: { percent: number; remaining: string; reached: boolean; monthsToGo: number | null; forecastMonth: string | null; neededPerMonth: string | null; onTrack: boolean | null };
};

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;

/** Progresso com previsão, não só barra: o ritmo diz quando chega e se dá tempo. */
export function ListaMetas({ goals, accounts }: { goals: GoalListItem[]; accounts: AccountOption[] }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<{ open: boolean; goal: GoalListItem | null }>({ open: false, goal: null });
  const [contribution, setContribution] = useState<{ id: string; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, success: string) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.message ?? "Não deu certo.");
        return;
      }
      toast.success(success);
      setContribution(null);
      router.refresh();
    });

  const forecast = (g: GoalListItem) => {
    const p = g.progress;
    if (p.reached) return "Meta atingida";
    if (p.forecastMonth && p.monthsToGo !== null) return `No ritmo atual, chega em ${monthLabel(p.forecastMonth)} (${p.monthsToGo} ${p.monthsToGo === 1 ? "mês" : "meses"})`;
    if (g.accountId) return "Sem aportes nos últimos 3 meses para prever";
    return "Registre aportes para ver a previsão";
  };

  return (
    <div className="flex flex-col gap-6">
      {goals.length === 0 ? (
        <EmptyState icon={Target} title="Nenhuma meta criada" description="Defina um valor e um prazo. Vincule uma conta e o progresso segue o saldo dela." />
      ) : (
        <ul className="flex flex-col gap-4">
          {goals.map((g) => {
            const p = g.progress;
            return (
              <li key={g.id} className={cn("rounded-lg border border-border-subtle bg-surface-raised p-4 shadow-card", g.status === "PAUSED" && "opacity-70")}>
                <div className="flex items-start gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-title">{g.name}</span>
                    <span className="block text-caption text-ink-secondary">
                      {g.accountName ? `Segue ${g.accountName}` : "Acompanhada à mão"}
                      {g.deadline && ` · até ${formatShortDate(g.deadline)}`}
                      {g.status === "PAUSED" && " · pausada"}
                    </span>
                  </span>
                  <button type="button" aria-label={`Editar ${g.name}`} onClick={() => setSheet({ open: true, goal: g })} className="flex size-11 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-sunken">
                    <Pencil size={18} strokeWidth={1.5} />
                  </button>
                </div>

                <div className="mt-3 flex items-baseline justify-between gap-3">
                  <Valor cents={g.currentAmount} size="lg" tone="neutral" />
                  <span className="tabular text-caption text-ink-secondary">
                    de {formatBRL(BigInt(g.targetAmount))} · {formatPercent(p.percent)}
                  </span>
                </div>
                <span className="mt-2 block h-2 overflow-hidden rounded-full bg-surface-sunken">
                  <span className={cn("block h-full rounded-full", p.reached ? "bg-brand" : "bg-chart-2")} style={{ width: `${Math.min(100, p.percent)}%` }} />
                </span>

                <p className={cn("mt-3 text-caption", p.onTrack === false ? "text-warning" : "text-ink-secondary")}>
                  {forecast(g)}
                  {p.neededPerMonth && !p.reached && ` · precisa de ${formatBRL(BigInt(p.neededPerMonth))} por mês${p.onTrack === true ? " e está no ritmo" : p.onTrack === false ? ", acima do ritmo atual" : ""}`}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {!g.accountId && !p.reached && (
                    contribution?.id === g.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const cents = parseBRL(contribution.text);
                          if (cents === null || cents === 0n) return;
                          run(() => contributeToGoalAction(g.id, cents.toString()), "Aporte registrado");
                        }}
                        className="flex items-center gap-2"
                      >
                        <input
                          inputMode="decimal"
                          autoFocus
                          aria-label="Valor do aporte"
                          value={contribution.text}
                          onChange={(e) => setContribution({ id: g.id, text: e.target.value })}
                          placeholder="0,00"
                          className="tabular h-9 w-32 rounded-md border border-border-strong bg-surface-sunken px-3 text-body"
                        />
                        <Botao type="submit" variant="primario" size="compacto" carregando={pending}>
                          Aportar
                        </Botao>
                        <Botao type="button" variant="sutil" size="compacto" onClick={() => setContribution(null)}>
                          Cancelar
                        </Botao>
                      </form>
                    ) : (
                      <Botao variant="secundario" size="compacto" onClick={() => setContribution({ id: g.id, text: "" })}>
                        <Plus strokeWidth={1.5} /> Aporte
                      </Botao>
                    )
                  )}
                  <Botao variant="sutil" size="compacto" disabled={pending} onClick={() => run(() => setGoalStatusAction(g.id, g.status === "PAUSED" ? "ACTIVE" : "PAUSED"), g.status === "PAUSED" ? "Meta retomada" : "Meta pausada")}>
                    {g.status === "PAUSED" ? "Retomar" : "Pausar"}
                  </Botao>
                  <Botao variant="sutil" size="compacto" disabled={pending} onClick={() => run(() => setGoalStatusAction(g.id, "ARCHIVED"), "Meta arquivada")}>
                    Arquivar
                  </Botao>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Botao variant="primario" className="w-full lg:w-auto" onClick={() => setSheet({ open: true, goal: null })}>
        <Plus strokeWidth={1.5} /> Nova meta
      </Botao>

      <GoalSheet open={sheet.open} goal={sheet.goal} accounts={accounts} onClose={() => setSheet((s) => ({ ...s, open: false }))} />
    </div>
  );
}
