"use client";

import { Toaster as Sonner } from "sonner";

/** Toasts com as superfícies do Design System; segue o tema do <html data-theme>. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      offset={{ bottom: 96 }}
      mobileOffset={{ bottom: 96 }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-3 rounded-lg border border-border-subtle bg-surface-raised px-4 py-3 text-body text-ink-primary shadow-sheet",
          title: "text-body",
          description: "text-caption text-ink-secondary",
          actionButton: "ml-auto h-9 shrink-0 rounded-md bg-brand px-3 text-body-strong text-on-brand",
          cancelButton: "ml-auto h-9 shrink-0 rounded-md border border-border-strong px-3 text-body-strong",
        },
      }}
    />
  );
}
