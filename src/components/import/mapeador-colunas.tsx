"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Botao } from "@/components/botao";
import { Field, NativeSelect } from "@/components/form";
import { applyCsvMappingAction } from "@/server/actions/import";
import type { CsvMapping } from "@/server/services/import/types";

type Preview = { header: string[] | null; sample: string[][] };

type Props = { batchId: string; preview: Preview };

const NONE = "";

/** CSV sem colunas reconhecidas: a pessoa diz qual coluna é data, descrição e valor. */
export function MapeadorColunas({ batchId, preview }: Props) {
  const router = useRouter();
  const width = Math.max(preview.header?.length ?? 0, ...preview.sample.map((r) => r.length));
  const columns = Array.from({ length: width }, (_, i) => ({ index: i, label: preview.header?.[i]?.trim() || `Coluna ${i + 1}` }));
  const [state, setState] = useState({
    date: "0",
    description: "1",
    mode: "amount" as "amount" | "split",
    amount: "2",
    credit: NONE,
    debit: NONE,
    memo: NONE,
    dateFormat: "DMY" as CsvMapping["dateFormat"],
    hasHeader: preview.header !== null,
    invertSign: false,
  });
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof typeof state>(k: K, v: (typeof state)[K]) => setState((s) => ({ ...s, [k]: v }));

  const submit = () => {
    const mapping: CsvMapping = {
      date: Number(state.date),
      description: Number(state.description),
      amount: state.mode === "amount" ? Number(state.amount) : null,
      credit: state.mode === "split" && state.credit !== NONE ? Number(state.credit) : null,
      debit: state.mode === "split" && state.debit !== NONE ? Number(state.debit) : null,
      memo: state.memo !== NONE ? Number(state.memo) : null,
      dateFormat: state.dateFormat,
      hasHeader: state.hasHeader,
      invertSign: state.invertSign,
    };
    startTransition(async () => {
      const result = await applyCsvMappingAction(batchId, mapping);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      router.refresh();
    });
  };

  const options = (allowNone: boolean) => (
    <>
      {allowNone && <option value={NONE}>—</option>}
      {columns.map((c) => (
        <option key={c.index} value={c.index}>
          {c.label}
        </option>
      ))}
    </>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      <div className="overflow-x-auto rounded-lg border border-border-subtle bg-surface-raised">
        <table className="w-full text-caption">
          <thead>
            <tr className="text-left text-micro text-ink-muted uppercase">
              {columns.map((c) => (
                <th key={c.index} className="px-3 py-2 font-medium whitespace-nowrap">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.sample.map((row, i) => (
              <tr key={i} className="border-t border-border-subtle">
                {columns.map((c) => (
                  <td key={c.index} className="tabular max-w-60 truncate px-3 py-2 text-ink-secondary">
                    {row[c.index] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Coluna da data">
          <NativeSelect value={state.date} onChange={(e) => set("date", e.target.value)}>{options(false)}</NativeSelect>
        </Field>
        <Field label="Formato da data">
          <NativeSelect value={state.dateFormat} onChange={(e) => set("dateFormat", e.target.value as CsvMapping["dateFormat"])}>
            <option value="DMY">dia/mês/ano</option>
            <option value="YMD">ano-mês-dia</option>
            <option value="MDY">mês/dia/ano</option>
          </NativeSelect>
        </Field>
        <Field label="Coluna da descrição">
          <NativeSelect value={state.description} onChange={(e) => set("description", e.target.value)}>{options(false)}</NativeSelect>
        </Field>
        <Field label="Observação (opcional)">
          <NativeSelect value={state.memo} onChange={(e) => set("memo", e.target.value)}>{options(true)}</NativeSelect>
        </Field>
        <Field label="Valor">
          <NativeSelect value={state.mode} onChange={(e) => set("mode", e.target.value as "amount" | "split")}>
            <option value="amount">Uma coluna com sinal</option>
            <option value="split">Crédito e débito separados</option>
          </NativeSelect>
        </Field>
        {state.mode === "amount" ? (
          <Field label="Coluna do valor">
            <NativeSelect value={state.amount} onChange={(e) => set("amount", e.target.value)}>{options(false)}</NativeSelect>
          </Field>
        ) : (
          <>
            <Field label="Coluna de crédito">
              <NativeSelect value={state.credit} onChange={(e) => set("credit", e.target.value)}>{options(true)}</NativeSelect>
            </Field>
            <Field label="Coluna de débito">
              <NativeSelect value={state.debit} onChange={(e) => set("debit", e.target.value)}>{options(true)}</NativeSelect>
            </Field>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex h-11 items-center gap-3 text-body">
          <input type="checkbox" checked={state.hasHeader} onChange={(e) => set("hasHeader", e.target.checked)} className="size-4 accent-brand" />
          A primeira linha é cabeçalho
        </label>
        <label className="flex h-11 items-center gap-3 text-body">
          <input type="checkbox" checked={state.invertSign} onChange={(e) => set("invertSign", e.target.checked)} className="size-4 accent-brand" />
          Inverter o sinal (fatura de cartão com gastos positivos)
        </label>
      </div>

      <Botao type="submit" variant="primario" carregando={pending} className="w-full lg:w-auto lg:self-end">
        Aplicar e ler de novo
      </Botao>
    </form>
  );
}
