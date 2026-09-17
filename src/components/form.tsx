import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const control =
  "h-11 w-full rounded-md border border-border-strong bg-surface-sunken px-3 text-body text-ink-primary placeholder:text-ink-muted aria-invalid:border-negative";

export function Field({ label, error, children }: { label: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-caption text-ink-secondary">{label}</span>
      {children}
      {error && <span className="text-caption text-negative">{error}</span>}
    </label>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, className)} {...props} />;
}

/** Select nativo: teclado, leitor de tela e o seletor do sistema no celular sem custo. */
export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, "appearance-none", className)} {...props} />;
}
