import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Botão do Design System Cifra: primário, secundário, sutil e destrutivo.
 * No máximo um primário por tela. 44px em toque, 36px na variante compacta.
 */
export const botaoVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-body-strong whitespace-nowrap transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primario: "bg-brand text-on-brand hover:bg-brand-strong active:bg-brand-strong",
        secundario: "border border-border-strong bg-transparent text-ink-primary hover:bg-surface-sunken",
        sutil: "bg-transparent text-ink-secondary hover:bg-surface-sunken hover:text-ink-primary",
        destrutivo: "border border-border-strong bg-transparent text-negative hover:bg-negative-soft",
      },
      size: {
        padrao: "h-11 px-4",
        compacto: "h-9 px-3",
        icone: "size-11",
      },
    },
    defaultVariants: { variant: "secundario", size: "padrao" },
  },
);

type BotaoProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof botaoVariants> & { carregando?: boolean };

export function Botao({ className, variant, size, carregando, children, disabled, ...props }: BotaoProps) {
  return (
    <button
      className={cn(botaoVariants({ variant, size }), className)}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      {...props}
    >
      {/* Mantém a largura ao carregar: o rótulo fica invisível por baixo do indicador. */}
      <span className={cn("inline-flex items-center gap-2", carregando && "invisible")}>{children}</span>
      {carregando && (
        <span className="absolute size-5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      )}
    </button>
  );
}
