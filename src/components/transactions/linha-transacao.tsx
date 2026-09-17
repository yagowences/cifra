"use client";

import { ArrowLeftRight, Paperclip, Repeat } from "lucide-react";
import { CategoriaIcone } from "@/components/categoria-icone";
import { Valor } from "@/components/money/valor";
import type { TransactionListItem } from "@/lib/transactions";
import { cn } from "@/lib/utils";

type Props = { item: TransactionListItem; onClick?: (item: TransactionListItem) => void };

/** Ícone de categoria, descrição, contexto e valor — nesta ordem, sempre. 64px de altura. */
export function LinhaTransacao({ item, onClick }: Props) {
  const isTransfer = item.type === "TRANSFER";
  const context = isTransfer
    ? `${item.accountName} → ${item.transferAccountName ?? "?"}`
    : [item.accountName, item.category?.name ?? "Sem categoria"].join(" · ");
  const needsReview = !item.reviewed;
  const projected = item.status === "PROJECTED";

  return (
    <button
      type="button"
      onClick={() => onClick?.(item)}
      data-testid="linha-transacao"
      className={cn(
        "flex h-16 w-full items-center gap-3 border-t border-border-subtle px-4 text-left transition-colors duration-150 hover:bg-surface-raised",
        projected && "opacity-60",
      )}
    >
      {isTransfer ? (
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-surface-sunken text-ink-secondary"
        >
          <ArrowLeftRight size={18} strokeWidth={1.75} />
        </span>
      ) : (
        <CategoriaIcone icon={item.category?.icon} color={needsReview ? "warning" : item.category?.color} />
      )}

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-body">{item.description}</span>
          {item.installment && <span className="shrink-0 text-caption text-ink-muted">{item.installment}</span>}
          {item.recurring && <Repeat size={13} strokeWidth={2} className="shrink-0 text-ink-muted" aria-label="Recorrente" />}
          {item.attachments > 0 && (
            <Paperclip size={13} strokeWidth={2} className="shrink-0 text-ink-muted" aria-label="Com anexo" />
          )}
          {needsReview && <span aria-label="Precisa de revisão" className="size-1.5 shrink-0 rounded-full bg-warning" />}
        </span>
        <span className={cn("block truncate text-caption", needsReview ? "text-warning" : "text-ink-secondary")}>
          {needsReview ? "Precisa de revisão" : projected ? `Previsto · ${context}` : context}
        </span>
      </span>

      <Valor cents={item.amount} sign symbol={false} tone={isTransfer ? "neutral" : "auto"} />
    </button>
  );
}
