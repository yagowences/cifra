"use client";

import { TriangleAlert } from "lucide-react";
import { Botao } from "@/components/botao";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center rounded-lg border border-border-subtle bg-surface-raised px-4 py-12 text-center"
    >
      <span className="flex size-10 items-center justify-center rounded-sm bg-negative-soft text-negative">
        <TriangleAlert strokeWidth={1.5} className="size-5" aria-hidden />
      </span>
      <h2 className="mt-4 text-title">Não consegui carregar esta tela</h2>
      <p className="mt-2 max-w-sm text-body text-ink-secondary">
        Seus dados não foram alterados. Tente de novo; se continuar, recarregue a página.
      </p>
      <Botao className="mt-6" onClick={reset}>
        Tentar de novo
      </Botao>
    </div>
  );
}
