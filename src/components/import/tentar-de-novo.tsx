"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Botao } from "@/components/botao";
import { retryImportAction } from "@/server/actions/import";

/** Reprocessa um lote que falhou ou ficou preso, com o arquivo que já foi enviado. */
export function TentarDeNovo({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const retry = () =>
    startTransition(async () => {
      const result = await retryImportAction(batchId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      router.refresh();
    });

  return (
    <Botao variant="primario" onClick={retry} carregando={pending}>
      <RotateCcw size={16} strokeWidth={1.5} aria-hidden /> Tentar de novo
    </Botao>
  );
}
