"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Botao } from "@/components/botao";
import { NativeSelect } from "@/components/form";
import { changeBatchAccountAction, deleteImportBatchAction } from "@/server/actions/import";

/**
 * Corrige um lote que ainda não foi confirmado: trocar a conta (corrente, cartão…) ou cancelar de
 * vez. Usa recarga completa da página no fim, como o resto do fluxo de importação.
 */
export function AcoesLote({ batchId, accountId, accounts, running }: { batchId: string; accountId: string; accounts: { id: string; name: string }[]; running: boolean }) {
  const [selected, setSelected] = useState(accountId);
  const [busy, setBusy] = useState<"troca" | "cancela" | null>(null);

  const trocar = async () => {
    setBusy("troca");
    try {
      const result = await changeBatchAccountAction(batchId, selected);
      if (!result.ok) {
        toast.error(result.message);
        setBusy(null);
        return;
      }
      window.location.reload();
    } catch {
      toast.error("Não consegui falar com o servidor. Recarregue a página para ver o estado do lote.");
      setBusy(null);
    }
  };

  const cancelar = async () => {
    if (!window.confirm("Cancelar esta importação? O lote é apagado e nada é lançado nas suas contas.")) return;
    setBusy("cancela");
    try {
      const result = await deleteImportBatchAction(batchId);
      if (!result.ok) {
        toast.error(result.message);
        setBusy(null);
        return;
      }
      window.location.assign("/importar");
    } catch {
      toast.error("Não consegui falar com o servidor. Tente de novo.");
      setBusy(null);
    }
  };

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-raised px-4 py-4 lg:flex-row lg:items-end">
      <label className="flex flex-1 flex-col gap-1.5 text-caption text-ink-secondary">
        Conta do lote
        <NativeSelect value={selected} onChange={(e) => setSelected(e.target.value)} disabled={running || busy !== null}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
      </label>
      <Botao variant="secundario" onClick={trocar} carregando={busy === "troca"} disabled={running || busy !== null || selected === accountId}>
        Trocar conta e reler
      </Botao>
      <Botao variant="destrutivo" onClick={cancelar} carregando={busy === "cancela"} disabled={busy !== null}>
        <Trash2 size={16} strokeWidth={1.5} aria-hidden /> Cancelar importação
      </Botao>
    </div>
  );
}
