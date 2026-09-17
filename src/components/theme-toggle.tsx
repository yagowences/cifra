"use client";

import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { otherTheme, THEME_COOKIE, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function ThemeToggle({ initial, withLabel, className }: { initial: Theme; withLabel?: boolean; className?: string }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const next = otherTheme(theme);
  const label = next === "light" ? "Tema claro" : "Tema escuro";

  const toggle = () => {
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    setTheme(next);
  };

  const Icon = next === "light" ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={withLabel ? undefined : label}
      data-testid="theme-toggle"
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-md text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink-primary",
        withLabel ? "px-3" : "w-11 justify-center",
        className,
      )}
    >
      <Icon strokeWidth={1.5} className="size-5" aria-hidden />
      {withLabel && <span className="text-body">{label}</span>}
    </button>
  );
}
