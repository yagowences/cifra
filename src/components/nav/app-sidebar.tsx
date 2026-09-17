"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { signOut } from "@/server/actions/auth";
import { isActive, NAV_ITEMS } from "./nav-items";

export function AppSidebar({ theme, email }: { theme: Theme; email: string }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border-subtle bg-surface-raised lg:flex">
      <div className="px-6 pt-6 pb-8 text-heading">Cifra</div>

      <nav aria-label="Principal" className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-11 items-center gap-3 rounded-md px-3 text-body transition-colors duration-150",
                active ? "bg-brand-soft text-ink-primary" : "text-ink-secondary hover:bg-surface-sunken hover:text-ink-primary",
              )}
            >
              <Icon strokeWidth={1.5} className={cn("size-5", active && "text-brand")} aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-1 border-t border-border-subtle p-3">
        <ThemeToggle initial={theme} withLabel className="w-full" />
        <form action={signOut}>
          <button
            type="submit"
            className="flex h-11 w-full items-center gap-2 rounded-md px-3 text-body text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink-primary"
          >
            <LogOut strokeWidth={1.5} className="size-5" aria-hidden />
            Sair
          </button>
        </form>
        <p className="truncate px-3 pt-2 text-caption text-ink-muted" title={email}>
          {email}
        </p>
      </div>
    </aside>
  );
}
