"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Botao } from "@/components/botao";
import { retryImportAction } from "@/server/actions/import";

/** Reprocessa um lote que falhou ou ficou preso, com o arquivo que já foi enviado. */
export function TentarDeNovo({ batchId }: { batchId: string }) {
  const [carregando, setCarregando] = useState(false);

  const retry = async () => {
    setCarregando(true);
    try {
      const result = await retryImportAction(batchId);
      if (!result.ok) {
        toast.error(result.message);
        setCarregando(false);
        return;
      }
      // Recarga completa (como o F5): `router.refresh()` deixou o botão girando em produção mesmo
      // com o lote já pronto no servidor.
      window.location.reload();
    } catch {
      toast.error("Não consegui falar com o servidor. Recarregue a página para ver o estado do lote.");
      setCarregando(false);
    }
  };

  return (
    <Botao variant="primario" onClick={retry} carregando={carregando}>
      <RotateCcw size={16} strokeWidth={1.5} aria-hidden /> Tentar de novo
    </Botao>
  );
}
