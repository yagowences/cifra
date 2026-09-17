"use client";

import { Camera, ChevronRight, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Botao } from "@/components/botao";
import { Field, NativeSelect, TextInput } from "@/components/form";
import { Valor } from "@/components/money/valor";
import { SeloConfianca } from "@/components/selo-confianca";
import type { AccountOption, CategoryOption } from "@/components/transactions/transaction-sheet-provider";
import { formatShortDate } from "@/lib/dates";
import { formatBRL, parseBRL } from "@/lib/money";
import { uploadUserFile } from "@/lib/supabase/storage";
import { cn } from "@/lib/utils";
import { confirmReceiptAction, readReceiptAction, type ReceiptReading } from "@/server/actions/receipts";

type Props = { accounts: AccountOption[]; categories: CategoryOption[]; userId: string };

type Uploaded = { storageKey: string; mimeType: "image/jpeg" | "image/png" | "image/webp"; sizeBytes: number; previewUrl: string };

const MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Foto → leitura por IA → confirmação campo a campo com selo de confiança →
 * duplicata oferecida antes de criar nova → transação com anexo.
 */
export function LeitorComprovante({ accounts, categories, userId }: Props) {
  const router = useRouter();
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const [reading, setReading] = useState<ReceiptReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ amountText: "", date: "", merchant: "", accountId: accounts[0]?.id ?? "", categoryId: "" });

  useEffect(() => {
    const url = uploaded?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [uploaded]);

  const expenseCategories = useMemo(() => categories.filter((c) => c.type === "EXPENSE"), [categories]);

  const onFile = (file: File | null) => {
    if (!file) return;
    if (!MIME.has(file.type)) {
      setError("Envie uma foto JPG, PNG ou WebP.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const storageKey = await uploadUserFile(file, userId, "receipts");
        const up: Uploaded = { storageKey, mimeType: file.type as Uploaded["mimeType"], sizeBytes: file.size, previewUrl: URL.createObjectURL(file) };
        setUploaded(up);
        const result = await readReceiptAction({ storageKey, mimeType: up.mimeType, sizeBytes: file.size });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        const r = result.data.receipt;
        const suggested = r.suggestedCategory ? expenseCategories.find((c) => c.name.localeCompare(r.suggestedCategory!, "pt-BR", { sensitivity: "base" }) === 0) : undefined;
        setReading(result.data);
        setForm((f) => ({ ...f, amountText: formatBRL(BigInt(r.amount), { symbol: false }), date: r.date, merchant: r.merchant, categoryId: suggested?.id ?? "" }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha no envio.");
      }
    });
  };

  const confirm = (attachTo: string | null) => {
    if (!uploaded || !reading) return;
    const cents = parseBRL(form.amountText);
    if (!attachTo && (cents === null || cents <= 0n)) {
      setError("Informe um valor maior que zero.");
      return;
    }
    startTransition(async () => {
      const result = await confirmReceiptAction({
        file: { storageKey: uploaded.storageKey, mimeType: uploaded.mimeType, sizeBytes: uploaded.sizeBytes },
        ocrData: reading.receipt,
        attachTo,
        transaction: attachTo
          ? null
          : {
              accountId: form.accountId,
              amount: (cents! < 0n ? -cents! : cents!).toString(),
              date: form.date,
              merchant: form.merchant,
              categoryId: form.categoryId || null,
              confidence: Math.min(reading.receipt.confidence.amount, reading.receipt.confidence.date, reading.receipt.confidence.merchant),
            },
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success(result.data.attached ? "Comprovante anexado ao lançamento" : "Lançamento salvo com o comprovante");
      router.push(`/transacoes?mes=${form.date.slice(0, 7)}`);
      router.refresh();
    });
  };

  if (!uploaded || !reading) {
    return (
      <div className="flex flex-col gap-4">
        <label
          className={cn(
            "flex min-h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface-sunken px-4 py-8 text-center transition-colors duration-150 hover:border-brand",
            pending && "opacity-60",
          )}
        >
          <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={pending} onChange={(e) => onFile(e.target.files?.[0] ?? null)} data-testid="foto" />
          <span className="flex size-10 items-center justify-center rounded-sm bg-brand-soft text-brand">
            <Camera strokeWidth={1.5} className="size-5" aria-hidden />
          </span>
          <span className="text-body-strong">{pending ? "Lendo o comprovante…" : "Fotografe ou escolha o comprovante"}</span>
          <span className="text-caption text-ink-secondary">A IA lê valor, data e estabelecimento; você confere antes de salvar.</span>
        </label>
        {/* Preview local (blob:), fora do alcance do next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {uploaded && pending && <img src={uploaded.previewUrl} alt="" className="max-h-64 w-full rounded-lg object-cover opacity-70" />}
        {error && (
          <p role="alert" className="rounded-md bg-negative-soft p-3 text-caption text-ink-primary">
            {error}
          </p>
        )}
      </div>
    );
  }

  const { receipt, candidates } = reading;
  const low = (v: number) => v < 0.8;

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={uploaded.previewUrl} alt="Foto do comprovante" className="max-h-72 w-full rounded-lg object-cover lg:max-h-[520px]" />

      <div className="flex flex-col gap-4">
        <Field label="Valor">
          <span className="flex items-center gap-2">
            <TextInput inputMode="decimal" value={form.amountText} onChange={(e) => setForm((f) => ({ ...f, amountText: e.target.value }))} className={cn("tabular", low(receipt.confidence.amount) && "border-warning")} />
            <SeloConfianca value={receipt.confidence.amount} />
          </span>
        </Field>
        <Field label="Data">
          <span className="flex items-center gap-2">
            <TextInput type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={cn(low(receipt.confidence.date) && "border-warning")} />
            <SeloConfianca value={receipt.confidence.date} />
          </span>
        </Field>
        <Field label="Estabelecimento">
          <span className="flex items-center gap-2">
            <TextInput value={form.merchant} onChange={(e) => setForm((f) => ({ ...f, merchant: e.target.value }))} maxLength={120} className={cn(low(receipt.confidence.merchant) && "border-warning")} />
            <SeloConfianca value={receipt.confidence.merchant} />
          </span>
        </Field>
        <Field label="Categoria">
          <NativeSelect value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}>
            <option value="">Sem categoria</option>
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Conta">
          <NativeSelect value={form.accountId} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {candidates.length > 0 && (
          <div className="flex flex-col gap-3 rounded-lg bg-warning-soft p-4">
            <p className="flex items-start gap-2 text-body">
              <TriangleAlert size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-warning" aria-hidden />
              <span>
                Já existe um lançamento de <Valor cents={BigInt(receipt.amount)} tone="neutral" /> em {formatShortDate(candidates[0].date).slice(0, 5)} na conta {candidates[0].accountName}.
              </span>
            </p>
            <ul className="flex flex-col gap-2">
              {candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => confirm(c.id)}
                    className="flex h-11 w-full items-center gap-3 rounded-md border border-border-strong px-3 text-left text-body hover:bg-surface-sunken"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {c.description} <span className="text-caption text-ink-secondary">· {c.accountName}{c.hasAttachment ? " · já tem anexo" : ""}</span>
                    </span>
                    <span className="text-caption text-ink-secondary">Anexar à existente</span>
                    <ChevronRight size={16} strokeWidth={2} className="text-ink-muted" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md bg-negative-soft p-3 text-caption text-ink-primary">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-3 lg:flex-row-reverse">
          <Botao variant="primario" className="w-full lg:w-auto" carregando={pending} onClick={() => confirm(null)}>
            Criar nova
          </Botao>
          <Botao
            variant="sutil"
            className="w-full lg:w-auto"
            disabled={pending}
            onClick={() => {
              setUploaded(null);
              setReading(null);
            }}
          >
            Outra foto
          </Botao>
        </div>
      </div>
    </div>
  );
}
