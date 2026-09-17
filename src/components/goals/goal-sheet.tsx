"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Botao } from "@/components/botao";
import { Field, NativeSelect, TextInput } from "@/components/form";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { AccountOption } from "@/components/transactions/transaction-sheet-provider";
import { formatBRL, parseBRL } from "@/lib/money";
import { saveGoalAction } from "@/server/actions/goals";
import type { GoalListItem } from "./lista-metas";

export const GOAL_TYPES = [
  { value: "TARGET_AMOUNT", label: "Juntar um valor" },
  { value: "EMERGENCY_FUND", label: "Reserva de emergência" },
  { value: "RECURRING_CONTRIBUTION", label: "Aporte recorrente" },
  { value: "SPENDING_REDUCTION", label: "Reduzir um gasto" },
  { value: "FREE", label: "Livre" },
] as const;

type GoalType = (typeof GOAL_TYPES)[number]["value"];

type Props = { open: boolean; goal: GoalListItem | null; accounts: AccountOption[]; onClose: () => void };

export function GoalSheet({ open, goal, accounts, onClose }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", type: "TARGET_AMOUNT" as GoalType, targetText: "", currentText: "", deadline: "", accountId: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setForm({
        name: goal?.name ?? "",
        type: (goal?.type as GoalType) ?? "TARGET_AMOUNT",
        targetText: goal ? formatBRL(BigInt(goal.targetAmount), { symbol: false }) : "",
        currentText: goal && !goal.accountId ? formatBRL(BigInt(goal.currentAmount), { symbol: false }) : "",
        deadline: goal?.deadline ?? "",
        accountId: goal?.accountId ?? "",
      });
      setError(null);
    }
  }, [open, goal]);

  const submit = () => {
    const target = parseBRL(form.targetText);
    const current = form.currentText.trim() ? parseBRL(form.currentText) : 0n;
    if (target === null || target <= 0n) return setError("Informe o valor alvo.");
    if (current === null) return setError("Valor atual inválido.");
    startTransition(async () => {
      const result = await saveGoalAction({
        id: goal?.id,
        input: {
          name: form.name,
          type: form.type,
          targetAmount: target.toString(),
          currentAmount: (current < 0n ? 0n : current).toString(),
          deadline: form.deadline || null,
          accountId: form.accountId || null,
          icon: null,
        },
      });
      if (!result.ok) return setError(result.message);
      toast.success(goal ? "Meta atualizada" : "Meta criada");
      onClose();
      router.refresh();
    });
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        aria-describedby={undefined}
        className="mx-auto max-h-[92dvh] w-full gap-0 overflow-y-auto rounded-t-xl border-border-subtle bg-surface-overlay p-0 text-ink-primary shadow-sheet backdrop-blur-[12px] lg:max-w-lg lg:rounded-xl lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-4 px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))]"
        >
          <div className="mx-auto h-1 w-10 rounded-full bg-border-strong lg:hidden" aria-hidden />
          <SheetTitle className="text-title">{goal ? "Editar meta" : "Nova meta"}</SheetTitle>
          <Field label="Nome">
            <TextInput value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex.: Viagem para o Chile" maxLength={80} required autoFocus={!goal} />
          </Field>
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Tipo">
              <NativeSelect value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as GoalType }))}>
                {GOAL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Prazo (opcional)">
              <TextInput type="date" value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} />
            </Field>
            <Field label="Valor alvo">
              <TextInput inputMode="decimal" value={form.targetText} onChange={(e) => setForm((f) => ({ ...f, targetText: e.target.value }))} placeholder="0,00" className="tabular" required />
            </Field>
            <Field label="Conta vinculada (opcional)">
              <NativeSelect value={form.accountId} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}>
                <option value="">Acompanhar à mão</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          {!form.accountId && (
            <Field label="Já guardado">
              <TextInput inputMode="decimal" value={form.currentText} onChange={(e) => setForm((f) => ({ ...f, currentText: e.target.value }))} placeholder="0,00" className="tabular" />
            </Field>
          )}
          {error && (
            <p role="alert" className="rounded-md bg-negative-soft p-3 text-caption text-ink-primary">
              {error}
            </p>
          )}
          <Botao type="submit" variant="primario" className="w-full" carregando={pending}>
            Salvar
          </Botao>
        </form>
      </SheetContent>
    </Sheet>
  );
}
