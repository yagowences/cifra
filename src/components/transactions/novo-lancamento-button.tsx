"use client";

import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { botaoVariants } from "@/components/botao";
import { cn } from "@/lib/utils";
import { useTransactionSheet } from "./transaction-sheet-provider";

type Props = { variant?: "primario" | "secundario" | "fab"; className?: string; children?: ReactNode };

/** Abre o sheet de novo lançamento. A variante "fab" é o botão central da barra inferior. */
export function NovoLancamentoButton({ variant = "primario", className, children }: Props) {
  const { openNew } = useTransactionSheet();

  if (variant === "fab") {
    return (
      <button
        type="button"
        onClick={openNew}
        aria-label="Novo lançamento"
        className={cn("flex size-14 items-center justify-center rounded-full bg-brand text-on-brand shadow-sheet", className)}
      >
        <Plus strokeWidth={2} className="size-6" aria-hidden />
      </button>
    );
  }

  return (
    <button type="button" onClick={openNew} className={cn(botaoVariants({ variant }), className)}>
      <Plus strokeWidth={1.5} aria-hidden />
      {children ?? "Novo lançamento"}
    </button>
  );
}
