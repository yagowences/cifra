"use client";

import { ChevronRight, Info, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";
import { dismissInsightAction } from "@/server/actions/insights";
import type { InsightView } from "@/server/services/insights";

/** Banner clicável: leva à lista de transações que sustenta o número. Cor fala de atenção, nunca de valor. */
export function InsightBanner({ insight }: { insight: InsightView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const attention = insight.severity === "ATTENTION";
  const Icon = attention ? TriangleAlert : Info;

  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-border-subtle p-3.5", attention ? "bg-warning-soft" : "bg-surface-raised")}>
      <Link href={insight.href} className="flex min-w-0 flex-1 items-center gap-3">
        <Icon size={18} strokeWidth={1.5} className={cn("shrink-0", attention ? "text-warning" : "text-ink-secondary")} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-strong">{insight.title}</span>
          <span className="tabular block text-caption text-ink-secondary">{insight.body}</span>
        </span>
        <ChevronRight size={16} strokeWidth={2} className="shrink-0 text-ink-muted" aria-hidden />
      </Link>
      <button
        type="button"
        aria-label="Dispensar"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await dismissInsightAction(insight.id);
            router.refresh();
          })
        }
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface-sunken hover:text-ink-primary"
      >
        <X size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
