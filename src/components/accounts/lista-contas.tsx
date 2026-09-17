"use client";

import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Botao } from "@/components/botao";
import { CategoriaIcone } from "@/components/categoria-icone";
import { EmptyState } from "@/components/empty-state";
import { Valor } from "@/components/money/valor";
import { accountTypeIcon, accountTypeLabel, type AccountListItem } from "@/lib/accounts";
import { deleteAccountAction, setAccountArchivedAction } from "@/server/actions/accounts";
import { AccountSheet } from "./account-sheet";

export function ListaContas({ accounts }: { accounts: AccountListItem[] }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<{ open: boolean; account: AccountListItem | null }>({ open: false, account: null });
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

  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);
  const total = active.filter((a) => a.type !== "CREDIT_CARD").reduce((sum, a) => sum + BigInt(a.currentBalance), 0n);

  const row = (a: AccountListItem) => (
    <li key={a.id} className="flex h-16 items-center gap-3 border-t border-border-subtle px-4 first:border-t-0">
      <CategoriaIcone icon={accountTypeIcon(a.type)} color={a.archived ? "ink-muted" : "brand"} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">{a.name}</span>
        <span className="block truncate text-caption text-ink-secondary">
          {[accountTypeLabel(a.type), a.institution].filter(Boolean).join(" · ")}
        </span>
      </span>
      <Valor cents={a.currentBalance} tone="neutral" sign />
      <span className="flex shrink-0">
        <button type="button" aria-label={`Editar ${a.name}`} onClick={() => setSheet({ open: true, account: a })} className="flex size-11 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-sunken hover:text-ink-primary">
          <Pencil size={18} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label={a.archived ? `Reativar ${a.name}` : `Arquivar ${a.name}`}
          disabled={pending}
          onClick={() => run(() => setAccountArchivedAction(a.id, !a.archived), a.archived ? "Conta reativada" : "Conta arquivada")}
          className="flex size-11 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-sunken hover:text-ink-primary"
        >
          {a.archived ? <ArchiveRestore size={18} strokeWidth={1.5} /> : <Archive size={18} strokeWidth={1.5} />}
        </button>
        {a.archived && (
          <button
            type="button"
            aria-label={`Excluir ${a.name}`}
            disabled={pending}
            onClick={() => run(() => deleteAccountAction(a.id), "Conta excluída")}
            className="flex size-11 items-center justify-center rounded-md text-ink-secondary hover:bg-negative-soft hover:text-negative"
          >
            <Trash2 size={18} strokeWidth={1.5} />
          </button>
        )}
      </span>
    </li>
  );

  return (
    <>
      {active.length === 0 && archived.length === 0 ? (
        <EmptyState
          icon={Plus}
          title="Nenhuma conta ainda"
          description="Cadastre a conta corrente, o cartão ou o dinheiro que você usa. É por ela que os lançamentos entram."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="rounded-lg border border-border-subtle bg-surface-raised p-4">
            <p className="text-micro text-ink-muted uppercase">Saldo total</p>
            <Valor cents={total} size="lg" tone="neutral" className="mt-2 block" />
            <p className="mt-1 text-caption text-ink-secondary">{active.length} {active.length === 1 ? "conta ativa" : "contas ativas"} · cartões fora da soma</p>
          </div>
          {active.length > 0 && (
            <ul className="overflow-hidden rounded-lg border border-border-subtle bg-surface-raised">{active.map(row)}</ul>
          )}
          {archived.length > 0 && (
            <section>
              <h2 className="pb-2 text-micro text-ink-muted uppercase">Arquivadas</h2>
              <ul className="overflow-hidden rounded-lg border border-border-subtle bg-surface-raised">{archived.map(row)}</ul>
            </section>
          )}
        </div>
      )}

      <Botao variant="primario" className="mt-6 w-full lg:w-auto" onClick={() => setSheet({ open: true, account: null })}>
        <Plus strokeWidth={1.5} /> Nova conta
      </Botao>

      <AccountSheet open={sheet.open} account={sheet.account} onClose={() => setSheet((s) => ({ ...s, open: false }))} />
    </>
  );
}
