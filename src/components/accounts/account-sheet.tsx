"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Botao } from "@/components/botao";
import { Field, NativeSelect, TextInput } from "@/components/form";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ACCOUNT_TYPES, type AccountListItem, type AccountType } from "@/lib/accounts";
import { formatBRL, parseBRL } from "@/lib/money";
import { saveAccount } from "@/server/actions/accounts";

type Props = { open: boolean; account: AccountListItem | null; onClose: () => void };

type FormState = {
  name: string;
  type: AccountType;
  institution: string;
  initialBalanceText: string;
  closingDay: string;
  dueDay: string;
  creditLimitText: string;
};

function initialState(account: AccountListItem | null): FormState {
  return {
    name: account?.name ?? "",
    type: account?.type ?? "CHECKING",
    institution: account?.institution ?? "",
    initialBalanceText: account ? formatBRL(BigInt(account.initialBalance), { symbol: false, sign: true }) : "",
    closingDay: account?.closingDay?.toString() ?? "",
    dueDay: account?.dueDay?.toString() ?? "",
    creditLimitText: account?.creditLimit ? formatBRL(BigInt(account.creditLimit), { symbol: false }) : "",
  };
}

export function AccountSheet({ open, account, onClose }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initialState(account));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setForm(initialState(account));
      setErrors({});
    }
  }, [open, account]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const isCard = form.type === "CREDIT_CARD";

  const submit = () => {
    const initialBalance = form.initialBalanceText.trim() ? parseBRL(form.initialBalanceText) : 0n;
    const creditLimit = form.creditLimitText.trim() ? parseBRL(form.creditLimitText) : null;
    if (initialBalance === null) return setErrors({ initialBalance: "Valor inválido." });
    if (creditLimit === null && form.creditLimitText.trim()) return setErrors({ creditLimit: "Valor inválido." });

    startTransition(async () => {
      const result = await saveAccount({
        id: account?.id,
        input: {
          name: form.name,
          type: form.type,
          institution: form.institution || null,
          initialBalance: initialBalance.toString(),
          closingDay: isCard && form.closingDay ? Number(form.closingDay) : null,
          dueDay: isCard && form.dueDay ? Number(form.dueDay) : null,
          creditLimit: isCard && creditLimit ? creditLimit.toString() : null,
        },
      });
      if (!result.ok) return setErrors(result.fieldErrors ?? { form: result.message });
      toast.success(account ? "Conta atualizada" : "Conta criada");
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
          <SheetTitle className="text-title">{account ? "Editar conta" : "Nova conta"}</SheetTitle>

          <Field label="Nome da conta" error={errors.name}>
            <TextInput value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Nubank" maxLength={60} required autoFocus={!account} />
          </Field>

          <Field label="Tipo" error={errors.type}>
            <NativeSelect value={form.type} onChange={(e) => set("type", e.target.value as AccountType)}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field label="Instituição" error={errors.institution}>
            <TextInput value={form.institution} onChange={(e) => set("institution", e.target.value)} placeholder="Opcional" maxLength={60} />
          </Field>

          <Field label={isCard ? "Fatura em aberto (negativo)" : "Saldo inicial"} error={errors.initialBalance}>
            <TextInput inputMode="decimal" value={form.initialBalanceText} onChange={(e) => set("initialBalanceText", e.target.value)} placeholder="0,00" className="tabular" />
          </Field>

          {isCard && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Fecha dia" error={errors.closingDay}>
                <TextInput type="number" min={1} max={31} inputMode="numeric" value={form.closingDay} onChange={(e) => set("closingDay", e.target.value)} required />
              </Field>
              <Field label="Vence dia" error={errors.dueDay}>
                <TextInput type="number" min={1} max={31} inputMode="numeric" value={form.dueDay} onChange={(e) => set("dueDay", e.target.value)} required />
              </Field>
              <Field label="Limite" error={errors.creditLimit}>
                <TextInput inputMode="decimal" value={form.creditLimitText} onChange={(e) => set("creditLimitText", e.target.value)} placeholder="0,00" className="tabular" />
              </Field>
            </div>
          )}

          {errors.form && (
            <p role="alert" className="rounded-md bg-negative-soft p-3 text-caption text-ink-primary">
              {errors.form}
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
