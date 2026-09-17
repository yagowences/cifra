"use client";

import { FileUp, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Botao } from "@/components/botao";
import { Field, NativeSelect } from "@/components/form";
import { uploadImportFile } from "@/lib/supabase/storage";
import { cn } from "@/lib/utils";
import { startImportAction } from "@/server/actions/import";
import type { AccountOption } from "@/components/transactions/transaction-sheet-provider";

const ACCEPT = ".ofx,.qfx,.csv,.txt";

/** Envio de extrato: escolhe a conta, solta o arquivo, e a revisão abre em seguida. */
export function Dropzone({ accounts, userId }: { accounts: AccountOption[]; userId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!file || !accountId) return;
    setError(null);
    startTransition(async () => {
      try {
        const storageKey = await uploadImportFile(file, userId);
        const result = await startImportAction({ accountId, storageKey, fileName: file.name });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        toast.success("Arquivo enviado. Lendo os lançamentos…");
        router.push(`/importar/${result.data.batchId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha no envio.");
      }
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface-raised p-4"
    >
      <Field label="Conta do extrato">
        <NativeSelect value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer.files[0];
          if (dropped) setFile(dropped);
        }}
        className={cn(
          "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors duration-150",
          dragging ? "border-brand bg-brand-soft" : "border-border-strong bg-surface-sunken hover:border-brand",
        )}
      >
        <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="arquivo" />
        <span className="flex size-10 items-center justify-center rounded-sm bg-brand-soft text-brand">
          {file ? <FileUp strokeWidth={1.5} className="size-5" aria-hidden /> : <Upload strokeWidth={1.5} className="size-5" aria-hidden />}
        </span>
        {file ? (
          <>
            <span className="text-body-strong">{file.name}</span>
            <span className="tabular text-caption text-ink-secondary">{(file.size / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB · toque para trocar</span>
          </>
        ) : (
          <>
            <span className="text-body-strong">Solte o extrato aqui ou toque para escolher</span>
            <span className="text-caption text-ink-secondary">OFX ou CSV do seu banco. PDF chega em breve.</span>
          </>
        )}
      </label>

      {error && (
        <p role="alert" className="rounded-md bg-negative-soft p-3 text-caption text-ink-primary">
          {error}
        </p>
      )}

      <Botao type="submit" variant="primario" className="w-full lg:w-auto lg:self-end" carregando={pending} disabled={!file || !accountId}>
        Ler lançamentos
      </Botao>
    </form>
  );
}
