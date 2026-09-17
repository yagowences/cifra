"use client";

import { Ellipsis, House, Plus, Rows3, Target } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActive } from "./nav-items";

const TABS = [
  { href: "/", label: "Início", icon: House },
  { href: "/transacoes", label: "Transações", icon: Rows3 },
  { href: "/metas", label: "Metas", icon: Target },
  { href: "/mais", label: "Mais", icon: Ellipsis },
];

export function BottomNav() {
  const pathname = usePathname();
  const tab = ({ href, label, icon: Icon }: (typeof TABS)[number]) => {
    const active = isActive(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cn("flex size-13 items-center justify-center", active ? "text-brand" : "text-ink-muted")}
      >
        <Icon strokeWidth={1.5} className="size-[22px]" aria-hidden />
      </Link>
    );
  };

  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-40 flex h-19 items-center justify-around border-t border-border-subtle bg-surface-overlay px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-[12px] lg:hidden"
    >
      {TABS.slice(0, 2).map(tab)}
      {/* Lançamento rápido chega na tarefa 4; por ora leva à lista de transações. */}
      <Link
        href="/transacoes"
        aria-label="Novo lançamento"
        className="flex size-14 items-center justify-center rounded-full bg-brand text-on-brand shadow-sheet"
      >
        <Plus strokeWidth={2} className="size-6" aria-hidden />
      </Link>
      {TABS.slice(2).map(tab)}
    </nav>
  );
}
