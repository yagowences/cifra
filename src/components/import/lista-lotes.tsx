"use client";

import { FileText, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { botaoVariants } from "@/components/botao";
import { cn } from "@/lib/utils";
import { deleteImportBatchAction, undoImportAction } from "@/server/actions/import";

export type BatchListItem = {
  id: string;
  fileName: string;
  accountName: string;
  status: "PENDING" | "PROCESSING" | "READY_FOR_REVIEW" | "NEEDS_MAPPING" | "CONFIRMED" | "UNDONE" | "FAILED";
  readCount: number;
  createdCount: number;
  duplicateCount: number;
  createdAt: string;
};

const STATUS: Record<BatchListItem["status"], { label: string; tone: string }> = {
  PENDING: { label: "Na fila", tone: "text-ink-secondary" },
  PROCESSING: { label: "Lendo…", tone: "text-ink-secondary" },
  READY_FOR_REVIEW: { label: "Aguardando revisão", tone: "text-warning" },
  NEEDS_MAPPING: { label: "Precisa mapear colunas", tone: "text-warning" },
  CONFIRMED: { label: "Importado", tone: "text-positive" },
  UNDONE: { label: "Desfeito", tone: "text-ink-muted" },
  FAILED: { label: "Falhou", tone: "text-negative" },
};

export function ListaLotes({ batches }: { batches: BatchListItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

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

  if (batches.length === 0) return null;

  return (
    <section>
      <h2 className="pb-3 text-title">Importações</h2>
      <ul className="overflow-hidden rounded-lg border border-border-subtle bg-surface-raised">
        {batches.map((b) => {
          const s = STATUS[b.status];
          const reviewable = b.status === "READY_FOR_REVIEW" || b.status === "NEEDS_MAPPING" || b.status === "PENDING" || b.status === "PROCESSING";
          return (
            <li key={b.id} className="flex items-center gap-3 border-t border-border-subtle px-4 py-3 first:border-t-0">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-surface-sunken text-ink-secondary">
                <FileText size={18} strokeWidth={1.5} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body">{b.fileName}</span>
                <span className="tabular block truncate text-caption text-ink-secondary">
                  {b.accountName} · {b.createdAt}
                  {b.status === "CONFIRMED" && ` · ${b.readCount} lidos · ${b.createdCount} novos · ${b.duplicateCount} duplicados`}
                </span>
              </span>
              <span className={cn("hidden shrink-0 text-caption lg:block", s.tone)}>{s.label}</span>
              {reviewable && (
                <Link href={`/importar/${b.id}`} className={botaoVariants({ variant: "secundario", size: "compacto" })}>
                  Revisar
                </Link>
              )}
              {b.status === "CONFIRMED" && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => undoImportAction(b.id), "Importação desfeita")}
                  className={botaoVariants({ variant: "destrutivo", size: "compacto" })}
                >
                  <Undo2 strokeWidth={1.5} aria-hidden /> Desfazer
                </button>
              )}
              {(b.status === "FAILED" || b.status === "UNDONE") && (
                <button
                  type="button"
                  aria-label={`Apagar ${b.fileName}`}
                  disabled={pending}
                  onClick={() => run(() => deleteImportBatchAction(b.id), "Lote apagado")}
                  className="flex size-11 items-center justify-center rounded-md text-ink-secondary hover:bg-negative-soft hover:text-negative"
                >
                  <Trash2 size={18} strokeWidth={1.5} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
