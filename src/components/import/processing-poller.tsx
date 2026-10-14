"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

const INTERVAL_MS = 2000;

/**
 * Enquanto o lote está sendo lido, recarrega os dados da página. O próximo refresh só é agendado
 * depois que o anterior termina: em produção cada um leva ~1,7 s, mais que o intervalo, e com
 * setInterval cada refresh interrompia o anterior — nenhum chegava a atualizar a tela, e a pessoa
 * só via o lote pronto com F5. Localmente as respostas são mais rápidas e o problema não aparecia.
 */
export function ProcessingPoller() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Garante o reagendamento mesmo que o refresh termine sem `pending` chegar a mudar.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (pending) return;
    const id = setTimeout(() => {
      startTransition(() => router.refresh());
      setTick((t) => t + 1);
    }, INTERVAL_MS);
    return () => clearTimeout(id);
  }, [pending, tick, router]);

  return null;
}
