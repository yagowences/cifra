"use client";

import { Copy, Repeat, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Botao } from "@/components/botao";
import { Field, NativeSelect, TextInput } from "@/components/form";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { todayISO } from "@/lib/dates";
import { formatBRL, parseBRL } from "@/lib/money";
import { FREQUENCY_LABELS, type Frequency } from "@/lib/recurrence";
import type { TransactionListItem } from "@/lib/transactions";
import { cn } from "@/lib/utils";
import {
  deleteTransactionAction,
  duplicateTransactionAction,
  restoreTransactionAction,
  saveTransaction,
  stopRecurrenceAction,
} from "@/server/actions/transactions";
import type { AccountOption, CategoryOption } from "./transaction-sheet-provider";

type TxType = "EXPENSE" | "INCOME" | "TRANSFER";

const TYPES: { value: TxType; label: string }[] = [
  { value: "EXPENSE", label: "Despesa" },
  { value: "INCOME", label: "Receita" },
  { value: "TRANSFER", label: "Transferência" },
];

const INSTALLMENT_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 12, 18, 24, 36, 48];

type Props = {
  open: boolean;
  item: TransactionListItem | null;
  accounts: AccountOption[];
  categories: CategoryOption[];
  onClose: () => void;
};

type FormState = {
  type: TxType;
  amountText: string;
  accountId: string;
  transferAccountId: string;
  categoryId: string;
  competenceDate: string;
  description: string;
  notes: string;
  /** Só na criação: "" | "1" (à vista) ou N parcelas; "" | frequência. */
  installments: string;
  recurrence: "" | Frequency;
  /** Só ao editar parcela: aplicar nas futuras também. */
  scope: "this" | "future";
};

function initialState(item: TransactionListItem | null, accounts: AccountOption[]): FormState {
  if (!item) {
    return {
      type: "EXPENSE",
      amountText: "",
      accountId: accounts[0]?.id ?? "",
      transferAccountId: accounts[1]?.id ?? "",
      categoryId: "",
      competenceDate: todayISO(),
      description: "",
      notes: "",
      installments: "",
      recurrence: "",
      scope: "this",
    };
  }
  const magnitude = BigInt(item.amount) < 0n ? -BigInt(item.amount) : BigInt(item.amount);
  return {
    type: item.type,
    amountText: formatBRL(magnitude, { symbol: false }),
    accountId: item.accountId,
    transferAccountId: item.transferAccountId ?? "",
    categoryId: item.category?.id ?? "",
    competenceDate: item.competenceDate,
    description: item.description,
    notes: item.notes ?? "",
    installments: "",
    recurrence: "",
    scope: "this",
  };
}

export function TransactionSheet({ open, item, accounts, categories, onClose }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initialState(item, accounts));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  // Reabrir com outro item (ou novo) zera o formulário.
  useEffect(() => {
    if (open) {
      setForm(initialState(item, accounts));
      setErrors({});
    }
  }, [open, item, accounts]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const visibleCategories = useMemo(
    () => categories.filter((c) => c.type === (form.type === "INCOME" ? "INCOME" : "EXPENSE")),
    [categories, form.type],
  );

  const amountCents = parseBRL(form.amountText);
  const isEdit = item !== null;
  const isInstallment = Boolean(item?.installment);
  const isRecurring = Boolean(item?.recurrenceId);

  const finish = (message: string) => {
    toast.success(message);
    onClose();
    router.refresh();
  };

  const submit = () => {
    const cents = parseBRL(form.amountText);
    if (cents === null || cents <= 0n) {
      setErrors({ amount: "Informe um valor maior que zero." });
      return;
    }
    startTransition(async () => {
      const result = await saveTransaction({
        id: item?.id,
        input: {
          type: form.type,
          amount: (cents < 0n ? -cents : cents).toString(),
          accountId: form.accountId,
          transferAccountId: form.type === "TRANSFER" ? form.transferAccountId || null : null,
          categoryId: form.type === "TRANSFER" ? null : form.categoryId || null,
          competenceDate: form.competenceDate,
          description: form.description,
          notes: form.notes || null,
        },
        options: isEdit
          ? undefined
          : {
              installments: form.installments ? Number(form.installments) : undefined,
              recurrence: form.recurrence || undefined,
            },
        scope: isEdit && isInstallment ? form.scope : undefined,
      });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? { form: result.message });
        return;
      }
      finish(
        isEdit
          ? form.scope === "future"
            ? "Parcelas futuras atualizadas"
            : "Lançamento atualizado"
          : form.installments
            ? `Parcelado em ${form.installments}x`
            : form.recurrence
              ? "Recorrência criada"
              : "Lançamento salvo",
      );
    });
  };

  const duplicate = () => {
    if (!item) return;
    startTransition(async () => {
      const result = await duplicateTransactionAction(item.id);
      if (!result.ok) {
        setErrors({ form: result.message });
        return;
      }
      finish("Lançamento duplicado para hoje");
    });
  };

  const stop = () => {
    if (!item?.recurrenceId) return;
    startTransition(async () => {
      const result = await stopRecurrenceAction(item.recurrenceId!);
      if (!result.ok) {
        setErrors({ form: result.message });
        return;
      }
      finish("Recorrência encerrada");
    });
  };

  const remove = () => {
    if (!item) return;
    startTransition(async () => {
      const result = await deleteTransactionAction(item.id);
      if (!result.ok) {
        setErrors({ form: result.message });
        return;
      }
      const snapshot = result.data;
      onClose();
      router.refresh();
      toast("Lançamento excluído", {
        duration: 5000,
        action: {
          label: "Desfazer",
          onClick: async () => {
            const restored = await restoreTransactionAction(snapshot);
            if (restored.ok) {
              toast.success("Lançamento restaurado");
              router.refresh();
            } else {
              toast.error(restored.message);
            }
          },
        },
      });
    });
  };

  const badge = isInstallment ? `Parcela ${item?.installment}` : isRecurring ? "Recorrente" : null;

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
          <div className="flex items-center gap-2">
            <SheetTitle className="text-title">{isEdit ? "Editar lançamento" : "Novo lançamento"}</SheetTitle>
            {badge && (
              <span className="inline-flex h-6 items-center gap-1 rounded-sm bg-brand-soft px-2 text-micro text-ink-primary uppercase">
                {isRecurring && <Repeat size={12} strokeWidth={2} aria-hidden />}
                {badge}
              </span>
            )}
          </div>

          {!isEdit && (
            <div role="tablist" aria-label="Tipo" className="grid grid-cols-3 gap-1 rounded-md bg-surface-sunken p-1">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={form.type === t.value}
                  onClick={() => set("type", t.value)}
                  className={cn(
                    "h-9 rounded-sm text-caption font-medium transition-colors duration-150",
                    form.type === t.value ? "bg-surface-raised text-ink-primary shadow-card" : "text-ink-secondary",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <label className="flex flex-col items-center gap-1 py-2">
            <span className="text-micro text-ink-muted uppercase">{isInstallment ? "Valor da parcela" : "Valor"}</span>
            <span className="flex items-baseline gap-2">
              <span className="text-amount-lg text-ink-secondary">R$</span>
              <input
                name="amount"
                inputMode="decimal"
                autoFocus={!isEdit}
                placeholder="0,00"
                value={form.amountText}
                onChange={(e) => set("amountText", e.target.value)}
                onBlur={() => amountCents !== null && set("amountText", formatBRL(amountCents < 0n ? -amountCents : amountCents, { symbol: false }))}
                aria-invalid={Boolean(errors.amount) || undefined}
                className="tabular w-48 bg-transparent text-center text-amount-hero text-ink-primary outline-none placeholder:text-ink-muted"
              />
            </span>
            {errors.amount && <span className="text-caption text-negative">{errors.amount}</span>}
            {!isEdit && form.installments && amountCents !== null && amountCents > 0n && (
              <span className="tabular text-caption text-ink-secondary">
                {form.installments}x de {formatBRL(amountCents / BigInt(form.installments))} (aprox.)
              </span>
            )}
          </label>

          {form.type !== "TRANSFER" && (
            <Field label="Categoria" error={errors.categoryId}>
              <NativeSelect value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                <option value="">Sem categoria</option>
                {visibleCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}

          <Field label={form.type === "TRANSFER" ? "De" : "Conta"} error={errors.accountId}>
            <NativeSelect value={form.accountId} onChange={(e) => set("accountId", e.target.value)} required disabled={isEdit && isInstallment}>
              {accounts.length === 0 && <option value="">Cadastre uma conta primeiro</option>}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </Field>

          {form.type === "TRANSFER" && (
            <Field label="Para" error={errors.transferAccountId}>
              <NativeSelect value={form.transferAccountId} onChange={(e) => set("transferAccountId", e.target.value)} required>
                <option value="">Escolha a conta de destino</option>
                {accounts
                  .filter((a) => a.id !== form.accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
          )}

          <Field label="Data" error={errors.competenceDate}>
            <TextInput type="date" value={form.competenceDate} onChange={(e) => set("competenceDate", e.target.value)} required />
          </Field>

          <Field label="Descrição" error={errors.description}>
            <TextInput
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Ex.: Padaria, Uber, Salário"
              maxLength={200}
              required
            />
          </Field>

          {!isEdit && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Parcelar" error={errors.installments}>
                <NativeSelect
                  value={form.installments}
                  disabled={form.type === "TRANSFER" || Boolean(form.recurrence)}
                  onChange={(e) => set("installments", e.target.value)}
                >
                  <option value="">À vista</option>
                  {INSTALLMENT_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}x
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Repetir" error={errors.recurrence}>
                <NativeSelect
                  value={form.recurrence}
                  disabled={Boolean(form.installments)}
                  onChange={(e) => set("recurrence", e.target.value as FormState["recurrence"])}
                >
                  <option value="">Não repete</option>
                  {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => (
                    <option key={f} value={f}>
                      {FREQUENCY_LABELS[f]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          )}

          <Field label="Observação" error={errors.notes}>
            <TextInput value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Opcional" maxLength={2000} />
          </Field>

          {isEdit && isInstallment && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-caption text-ink-secondary">Aplicar a</legend>
              {(
                [
                  ["this", "Só esta parcela"],
                  ["future", `Esta e as futuras (de ${item?.installmentTotal ?? "?"})`],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex h-11 items-center gap-3 rounded-md border border-border-strong px-3 text-body">
                  <input type="radio" name="scope" value={value} checked={form.scope === value} onChange={() => set("scope", value)} className="accent-brand" />
                  {label}
                </label>
              ))}
            </fieldset>
          )}

          {errors.form && (
            <p role="alert" className="rounded-md bg-negative-soft p-3 text-caption text-ink-primary">
              {errors.form}
            </p>
          )}

          {isEdit && (
            <div className={cn("grid gap-3", isRecurring ? "grid-cols-3" : "grid-cols-2")}>
              <Botao type="button" onClick={duplicate} disabled={pending}>
                <Copy strokeWidth={1.5} /> Duplicar
              </Botao>
              {isRecurring && (
                <Botao type="button" onClick={stop} disabled={pending}>
                  <Repeat strokeWidth={1.5} /> Encerrar
                </Botao>
              )}
              <Botao type="button" variant="destrutivo" onClick={remove} disabled={pending}>
                <Trash2 strokeWidth={1.5} /> Excluir
              </Botao>
            </div>
          )}

          <Botao type="submit" variant="primario" className="w-full" carregando={pending} disabled={accounts.length === 0}>
            Salvar
          </Botao>
        </form>
      </SheetContent>
    </Sheet>
  );
}
