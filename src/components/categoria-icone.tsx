import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { iconeOuPadrao } from "./icones";

type Props = {
  /** Nome do ícone (kebab-case, ver icones.ts) e chave de cor do Design System (brand, chart-2…). */
  icon?: string | null;
  color?: string | null;
  size?: 40 | 32;
  className?: string;
};

/** Quadrado radius-sm preenchido pela cor da categoria a 14%, com o ícone em traço. */
export function CategoriaIcone({ icon, color, size = 40, className }: Props) {
  const token = color ?? "ink-muted";
  const Icon = iconeOuPadrao(icon);
  const style = {
    color: `var(--${token})`,
    background: `color-mix(in srgb, var(--${token}) 14%, transparent)`,
    width: size,
    height: size,
  } satisfies CSSProperties;

  return (
    <span aria-hidden className={cn("flex shrink-0 items-center justify-center rounded-sm", className)} style={style}>
      <Icon size={size === 40 ? 18 : 16} strokeWidth={1.75} />
    </span>
  );
}
