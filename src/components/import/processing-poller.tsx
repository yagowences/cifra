"use client";

import { useEffect } from "react";

const INTERVAL_MS = 2500;

/**
 * Enquanto o lote está sendo lido, pergunta a um endpoint leve se acabou e, quando acabou, recarrega
 * a página inteira. Antes isto usava `router.refresh()`; em produção a tela ficou parada em "Lendo"
 * mesmo com o lote pronto, e só o F5 resolvia — a recarga completa faz o mesmo que o F5 sem depender
 * da fila de navegação do Next.
 */
export function ProcessingPoller({ batchId }: { batchId: string }) {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const check = async () => {
      try {
        const res = await fetch(`/api/importar/${batchId}/status`, { cache: "no-store" });
        const body = (await res.json()) as { done?: boolean };
        if (!cancelled && body.done) {
          window.location.reload();
          return;
        }
      } catch {
        // Rede instável: tenta de novo no próximo ciclo.
      }
      if (!cancelled) timer = setTimeout(check, INTERVAL_MS);
    };

    timer = setTimeout(check, INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [batchId]);

  return null;
}
