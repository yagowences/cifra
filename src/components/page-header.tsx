import type { ReactNode } from "react";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-4 pb-6">
      <h1 className="text-heading">{title}</h1>
      {children}
    </header>
  );
}
