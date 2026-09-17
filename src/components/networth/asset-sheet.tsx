"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Botao } from "@/components/botao";
import { Field, NativeSelect, TextInput } from "@/components/form";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ASSET_CLASSES, type AssetClassValue, type AssetListItem } from "@/lib/assets";
import { formatBRL, parseBRL } from "@/lib/money";
import { saveAssetAction } from "@/server/actions/networth";

type Props = { open: boolean; asset: AssetListItem | null; liability: boolean; onClose: () => void };

export function AssetSheet({ open, asset, liability, onClose }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", class: "FIXED_INCOME" as AssetClassValue, valueText: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isLiability = asset?.isLiability ?? liability;

  useEffect(() => {
    if (open) {
      setForm({ name: asset?.name ?? "", class: asset?.class ?? (liability ? "OTHER" : "FIXED_INCOME"), valueText: asset ? formatBRL(BigInt(asset.currentValue), { symbol: false }) : "" });
      setError(null);
    }
  }, [open, asset, liability]);

  const submit = () => {
    const cents = parseBRL(form.valueText);
    if (cents === null || cents <= 0n) {
      setError("Informe um valor maior que zero.");
      return;
    }
    startTransition(async () => {
      const result = await saveAssetAction({ id: asset?.id, input: { name: form.name, class: form.class, currentValue: (cents < 0n ? -cents : cents).toString(), isLiability } });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success(asset ? "Atualizado" : isLiability ? "Dívida cadastrada" : "Ativo cadastrado");
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
          <SheetTitle className="text-title">{asset ? "Editar" : isLiability ? "Nova dívida" : "Novo ativo"}</SheetTitle>
          <Field label="Nome">
            <TextInput value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={isLiability ? "Ex.: Financiamento do apartamento" : "Ex.: Tesouro Selic"} maxLength={80} required autoFocus={!asset} />
          </Field>
          <Field label="Classe">
            <NativeSelect value={form.class} onChange={(e) => setForm((f) => ({ ...f, class: e.target.value as AssetClassValue }))}>
              {ASSET_CLASSES.filter((c) => c.value !== "CASH").map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={isLiability ? "Saldo devedor" : "Valor atual"}>
            <TextInput inputMode="decimal" value={form.valueText} onChange={(e) => setForm((f) => ({ ...f, valueText: e.target.value }))} placeholder="0,00" className="tabular" required />
          </Field>
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
