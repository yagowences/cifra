"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Botao } from "@/components/botao";
import { EmptyState } from "@/components/empty-state";
import { Field, NativeSelect, TextInput } from "@/components/form";
import type { CategoryOption } from "@/components/transactions/transaction-sheet-provider";
import { createRuleAction, deleteRuleAction, setRuleActiveAction } from "@/server/actions/categorize";
import { ListChecks } from "lucide-react";

export type RuleListItem = { id: string; name: string; contains: string[]; type: "INCOME" | "EXPENSE" | null; categoryName: string; active: boolean; hitCount: number };

export function ListaRegras({ rules, categories }: { rules: RuleListItem[]; categories: CategoryOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ contains: "", categoryId: categories[0]?.id ?? "", type: "" as "" | "INCOME" | "EXPENSE" });

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, success: string) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.message ?? "Não deu certo.");
        return;
      }
      toast.success(success);
      router.refresh();
    });

  const submit = () => {
    const contains = form.contains.split(",").map((s) => s.trim()).filter(Boolean);
    if (contains.length === 0 || !form.categoryId) return;
    const category = categories.find((c) => c.id === form.categoryId);
    run(
      () => createRuleAction({ name: `${contains[0]} → ${category?.name ?? ""}`, conditions: { descriptionContains: contains, ...(form.type ? { type: form.type } : {}) }, categoryId: form.categoryId }),
      "Regra criada",
    );
    setCreating(false);
    setForm((f) => ({ ...f, contains: "" }));
  };

  return (
    <div className="flex flex-col gap-6">
      {rules.length === 0 && !creating ? (
        <EmptyState
          icon={ListChecks}
          title="Nenhuma regra ainda"
          description="Regras categorizam de graça e antes de tudo: 'ifood' vira Alimentação sem perguntar. O app sugere uma quando você repete a mesma correção três vezes."
        />
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border-subtle bg-surface-raised">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-3 border-t border-border-subtle px-4 py-3 first:border-t-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body">
                  Contém {r.contains.map((c) => `“${c}”`).join(" ou ")} → {r.categoryName}
                </span>
                <span className="tabular block text-caption text-ink-secondary">
                  {r.type === "INCOME" ? "Só entradas · " : r.type === "EXPENSE" ? "Só saídas · " : ""}
                  {r.hitCount} {r.hitCount === 1 ? "uso" : "usos"}
                  {!r.active && " · pausada"}
                </span>
              </span>
              <label className="flex h-11 items-center gap-2 text-caption text-ink-secondary">
                <input type="checkbox" checked={r.active} disabled={pending} onChange={(e) => run(() => setRuleActiveAction(r.id, e.target.checked), e.target.checked ? "Regra ativada" : "Regra pausada")} className="size-4 accent-brand" />
                Ativa
              </label>
              <button type="button" aria-label={`Excluir regra ${r.name}`} disabled={pending} onClick={() => run(() => deleteRuleAction(r.id), "Regra excluída")} className="flex size-11 items-center justify-center rounded-md text-ink-secondary hover:bg-negative-soft hover:text-negative">
                <Trash2 size={18} strokeWidth={1.5} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface-raised p-4"
        >
          <Field label="Quando a descrição contém (separe alternativas por vírgula)">
            <TextInput value={form.contains} onChange={(e) => setForm((f) => ({ ...f, contains: e.target.value }))} placeholder="ifood, rappi" required autoFocus />
          </Field>
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Categoria">
              <NativeSelect value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type === "INCOME" ? "entrada" : "saída"})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Aplicar a">
              <NativeSelect value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as typeof f.type }))}>
                <option value="">Entradas e saídas</option>
                <option value="EXPENSE">Só saídas</option>
                <option value="INCOME">Só entradas</option>
              </NativeSelect>
            </Field>
          </div>
          <div className="flex gap-3">
            <Botao type="submit" variant="primario" carregando={pending}>
              Salvar regra
            </Botao>
            <Botao type="button" variant="sutil" onClick={() => setCreating(false)}>
              Cancelar
            </Botao>
          </div>
        </form>
      ) : (
        <Botao variant="secundario" className="w-full lg:w-auto" onClick={() => setCreating(true)}>
          <Plus strokeWidth={1.5} /> Nova regra
        </Botao>
      )}
    </div>
  );
}
