"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { addMonths, formatMonthYear } from "@/lib/dates";

/** Navegação de mês pela URL (?mes=YYYY-MM). */
export function MonthSwitcher({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [year, m] = month.split("-").map(Number);

  const shift = (delta: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("mes", addMonths(`${month}-01`, delta).slice(0, 7));
    next.delete("cursor");
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label="Mês anterior" onClick={() => shift(-1)} className="flex size-11 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-sunken">
        <ChevronLeft size={18} strokeWidth={2} />
      </button>
      <span className="min-w-32 text-center text-micro text-ink-secondary uppercase">{formatMonthYear(year, m)}</span>
      <button type="button" aria-label="Próximo mês" onClick={() => shift(1)} className="flex size-11 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-sunken">
        <ChevronRight size={18} strokeWidth={2} />
      </button>
    </div>
  );
}
