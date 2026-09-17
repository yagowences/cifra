"use client";

import { ArrowUp, ChevronRight, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { Answer } from "@/ai/assistant";
import { FluxoMensal } from "@/components/charts/fluxo-mensal";
import { cn } from "@/lib/utils";
import { askAssistantAction } from "@/server/actions/assistant";

type Turn = { role: "user" | "assistant"; text: string; links?: Answer["links"]; chart?: Answer["chart"]; error?: boolean };

const SUGGESTIONS = ["Quanto sobrou?", "Maiores gastos", "Minhas assinaturas"];

/**
 * Pergunta em bolha à direita; resposta à esquerda, sem bolha. Sob a resposta,
 * o card com o gráfico quando houver e os links para as transações — o link é
 * o que faz a resposta ser verificável.
 */
export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [turns, pending]);

  const ask = (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    setDraft("");
    const history = turns.filter((t) => !t.error).map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: "user", text: q }]);
    startTransition(async () => {
      const result = await askAssistantAction({ question: q, history });
      setTurns((t) => [
        ...t,
        result.ok ? { role: "assistant", text: result.data.text, links: result.data.links, chart: result.data.chart } : { role: "assistant", text: result.message, error: true },
      ]);
    });
  };

  return (
    <div className="flex min-h-[60dvh] flex-col">
      <div className="flex items-center justify-end pb-2">
        <button type="button" onClick={() => setTurns([])} disabled={turns.length === 0} className="flex h-11 items-center gap-2 rounded-md px-3 text-caption text-ink-secondary hover:bg-surface-sunken disabled:opacity-40">
          <RotateCcw size={16} strokeWidth={1.5} aria-hidden /> Nova conversa
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4">
        {turns.length === 0 && (
          <p className="py-8 text-center text-body text-ink-secondary">Pergunte sobre suas finanças. Toda resposta com número leva às transações que a compõem.</p>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <p key={i} className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-brand-soft px-4 py-2.5 text-body text-ink-primary">
              {t.text}
            </p>
          ) : (
            <div key={i} className="max-w-[92%] lg:max-w-[75%]">
              <p className={cn("text-body", t.error ? "text-negative" : "text-ink-primary")}>{t.text}</p>
              {t.chart && t.chart.length > 0 && (
                <div className="mt-3 rounded-lg border border-border-subtle bg-surface-raised p-3">
                  <FluxoMensal points={t.chart} />
                </div>
              )}
              {t.links && t.links.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {t.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="inline-flex h-9 items-center gap-1 text-caption text-brand hover:text-brand-strong">
                        {l.label} <ChevronRight size={14} strokeWidth={2} aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ),
        )}
        {pending && (
          <div aria-busy="true" className="flex flex-col gap-2">
            <div className="h-4 w-2/3 rounded-xs bg-surface-sunken" />
            <div className="h-4 w-1/2 rounded-xs bg-surface-sunken" />
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-20 mt-6 flex flex-col gap-3 bg-surface-base pt-2 lg:bottom-0">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:px-0">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" disabled={pending} onClick={() => ask(s)} className="h-9 shrink-0 rounded-sm border border-border-strong px-3.5 text-caption font-medium text-ink-secondary whitespace-nowrap hover:text-ink-primary">
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(draft);
          }}
          className="flex items-center gap-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Pergunte sobre suas finanças"
            maxLength={500}
            aria-label="Pergunta"
            className="h-11 min-w-0 flex-1 rounded-md border border-border-strong bg-surface-sunken px-3 text-body text-ink-primary placeholder:text-ink-muted"
          />
          <button type="submit" aria-label="Enviar" disabled={pending || !draft.trim()} className="flex size-11 shrink-0 items-center justify-center rounded-md bg-brand text-on-brand disabled:opacity-50">
            <ArrowUp size={20} strokeWidth={2} />
          </button>
        </form>
      </div>
    </div>
  );
}
