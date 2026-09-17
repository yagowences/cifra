import { ChevronRight, LogOut } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NAV_ITEMS } from "@/components/nav/nav-items";
import { PageHeader } from "@/components/page-header";
import { signOut } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Mais" };

const SECONDARY = new Set(["/contas", "/importar", "/comprovante", "/patrimonio", "/regras", "/assistente"]);

export default function MaisPage() {
  return (
    <>
      <PageHeader title="Mais" />
      <nav aria-label="Outras seções" className="overflow-hidden rounded-lg border border-border-subtle bg-surface-raised">
        {NAV_ITEMS.filter((item) => SECONDARY.has(item.href)).map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex h-16 items-center gap-3 border-b border-border-subtle px-4 last:border-b-0 hover:bg-surface-sunken"
          >
            <span className="flex size-10 items-center justify-center rounded-sm bg-brand-soft text-brand">
              <Icon strokeWidth={1.5} className="size-5" aria-hidden />
            </span>
            <span className="flex-1 text-body">{label}</span>
            <ChevronRight strokeWidth={1.5} className="size-5 text-ink-muted" aria-hidden />
          </Link>
        ))}
      </nav>
      <form action={signOut} className="mt-6">
        <button
          type="submit"
          className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-border-strong text-body-strong text-ink-primary hover:bg-surface-sunken"
        >
          <LogOut strokeWidth={1.5} className="size-5" aria-hidden />
          Sair
        </button>
      </form>
    </>
  );
}
