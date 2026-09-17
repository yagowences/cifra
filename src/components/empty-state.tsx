import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { botaoVariants } from "@/components/botao";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { href: string; label: string };
};

/** Estado vazio: explica o que falta e oferece a próxima ação, sem julgamento. */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-border-subtle bg-surface-raised px-4 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-sm bg-brand-soft text-brand">
        <Icon strokeWidth={1.5} className="size-5" aria-hidden />
      </span>
      <h2 className="mt-4 text-title">{title}</h2>
      <p className="mt-2 max-w-sm text-body text-ink-secondary">{description}</p>
      {action && (
        <Link href={action.href} className={botaoVariants({ variant: "secundario", className: "mt-6" })}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
