import { Check, FileSearch, FileText, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { botaoVariants } from "@/components/botao";
import { EmptyState } from "@/components/empty-state";
import { MapeadorColunas } from "@/components/import/mapeador-colunas";
import { ProcessingPoller } from "@/components/import/processing-poller";
import { TabelaRevisao } from "@/components/import/tabela-revisao";
import { PageHeader } from "@/components/page-header";
import { formatBRL } from "@/lib/money";
import { requireUserId } from "@/server/auth";
import { forUser } from "@/server/db";
import { readReviewRows } from "@/server/services/import";

export const metadata: Metadata = { title: "Revisão de importação" };

export default async function RevisaoImportacaoPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;

  const data = await forUser(userId, async (tx) => {
    const batch = await tx.importBatch.findFirst({ where: { id, userId }, include: { account: { select: { name: true } } } });
    if (!batch) return null;
    const categories = await tx.category.findMany({
      where: { userId },
      orderBy: [{ type: "desc" }, { sortOrder: "asc" }],
      select: { id: true, name: true, type: true, icon: true, color: true },
    });
    return { batch, categories };
  });

  if (!data) notFound();
  const { batch, categories } = data;
  const rows = readReviewRows(batch);
  const month = (rows[0]?.date ?? new Date().toISOString()).slice(0, 7);
  const steps = ["Envio", "Leitura", "Revisão", "Confirmação"];
  const current = batch.status === "CONFIRMED" ? 3 : batch.status === "READY_FOR_REVIEW" || batch.status === "NEEDS_MAPPING" ? 2 : 1;

  return (
    <>
      <PageHeader title="Revisar importação" />

      <ol className="flex items-center gap-3 pb-5 text-caption" aria-label="Etapas">
        {steps.map((step, i) => (
          <li key={step} className="flex items-center gap-3">
            <span className={i <= current ? (i === current ? "font-medium text-ink-primary" : "text-ink-secondary") : "text-ink-muted"}>
              <span aria-hidden className={`mr-2 inline-block size-2 rounded-full ${i <= current ? "bg-brand" : "border border-border-strong"}`} />
              {step}
            </span>
            {i < steps.length - 1 && <span aria-hidden className="h-px w-6 bg-border-strong lg:w-10" />}
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-4 pb-5 lg:flex-row">
        <div className="flex flex-1 items-center gap-3 rounded-lg border border-border-subtle bg-surface-raised px-4 py-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-surface-sunken text-ink-secondary">
            <FileText size={18} strokeWidth={1.5} aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-body-strong">{batch.fileName}</span>
            <span className="tabular block text-caption text-ink-secondary">
              {batch.status === "READY_FOR_REVIEW" || batch.status === "CONFIRMED" ? `${batch.readCount} lançamentos lidos · ` : ""}
              {batch.account.name}
            </span>
          </span>
        </div>
        {batch.status === "READY_FOR_REVIEW" && (
          <div
            className={`flex items-center gap-3 rounded-lg border border-border-subtle px-4 py-4 lg:w-80 ${batch.balanceDiff === null ? "bg-surface-raised" : batch.balanceDiff === 0n ? "bg-brand-soft" : "bg-warning-soft"}`}
          >
            {batch.balanceDiff === null ? (
              <FileSearch size={20} strokeWidth={1.5} className="shrink-0 text-ink-secondary" aria-hidden />
            ) : batch.balanceDiff === 0n ? (
              <Check size={20} strokeWidth={2} className="shrink-0 text-brand" aria-hidden />
            ) : (
              <TriangleAlert size={20} strokeWidth={1.5} className="shrink-0 text-warning" aria-hidden />
            )}
            <span>
              <span className="block text-body-strong">
                {batch.balanceDiff === null ? "Sem saldo declarado" : batch.balanceDiff === 0n ? "Saldo confere" : "Saldo não confere"}
              </span>
              <span className="tabular block text-caption text-ink-secondary">
                {batch.balanceDiff === null
                  ? "Este formato não traz o saldo do extrato."
                  : batch.balanceDiff === 0n
                    ? `${formatBRL(batch.declaredClosingBalance ?? 0n)} no extrato e nos lançamentos`
                    : `Diferença de ${formatBRL(batch.balanceDiff < 0n ? -batch.balanceDiff : batch.balanceDiff)} entre o extrato e os lançamentos`}
              </span>
            </span>
          </div>
        )}
      </div>

      {batch.error && batch.status !== "FAILED" && (
        <div className="mb-5 flex items-start gap-3 rounded-lg bg-warning-soft px-4 py-3 text-caption">
          <TriangleAlert size={18} strokeWidth={1.5} className="mt-px shrink-0 text-warning" aria-hidden />
          <span className="whitespace-pre-line text-ink-primary">
            {batch.errorCount} {batch.errorCount === 1 ? "linha não foi lida" : "linhas não foram lidas"}; as outras {batch.readCount} entraram.{"\n"}
            <span className="text-ink-secondary">{batch.error}</span>
          </span>
        </div>
      )}

      {(batch.status === "PENDING" || batch.status === "PROCESSING") && (
        <>
          <ProcessingPoller />
          <div aria-busy="true" className="flex flex-col gap-3">
            <p className="text-body text-ink-secondary">Lendo os lançamentos…</p>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-14 rounded-lg bg-surface-sunken" />
            ))}
          </div>
        </>
      )}

      {batch.status === "NEEDS_MAPPING" && (
        <>
          <p className="pb-4 text-body text-ink-secondary">Não reconheci as colunas deste CSV. Diga qual é a data, a descrição e o valor.</p>
          <MapeadorColunas batchId={batch.id} preview={readPreview(batch.columnMapping)} />
        </>
      )}

      {batch.status === "READY_FOR_REVIEW" &&
        (rows.length === 0 ? (
          <EmptyState icon={FileSearch} title="Nenhum lançamento lido" description="O arquivo não trouxe lançamentos que eu conseguisse entender." action={{ href: "/importar", label: "Enviar outro arquivo" }} />
        ) : (
          <TabelaRevisao batchId={batch.id} rows={rows} categories={categories} month={month} />
        ))}

      {batch.status === "CONFIRMED" && (
        <EmptyState
          icon={Check}
          title="Importação concluída"
          description={`${batch.readCount} lidos · ${batch.createdCount} novos · ${batch.duplicateCount} duplicados`}
          action={{ href: `/transacoes?mes=${month}`, label: "Ver transações" }}
        />
      )}

      {batch.status === "UNDONE" && <EmptyState icon={FileSearch} title="Importação desfeita" description="Os lançamentos deste lote foram removidos." action={{ href: "/importar", label: "Voltar" }} />}

      {batch.status === "FAILED" && (
        <div className="flex flex-col items-start gap-4">
          <div className="flex items-start gap-3 rounded-lg bg-negative-soft px-4 py-3 text-caption">
            <TriangleAlert size={18} strokeWidth={1.5} className="mt-px shrink-0 text-negative" aria-hidden />
            <span className="text-ink-primary">{batch.error ?? "Não consegui importar este arquivo."}</span>
          </div>
          <Link href="/importar" className={botaoVariants({ variant: "secundario" })}>
            Enviar outro arquivo
          </Link>
        </div>
      )}
    </>
  );
}

function readPreview(value: unknown): { header: string[] | null; sample: string[][] } {
  const p = (value && typeof value === "object" && "preview" in value ? (value as { preview?: unknown }).preview : null) as
    | { header?: unknown; sample?: unknown }
    | null;
  const header = Array.isArray(p?.header) ? (p!.header as string[]) : null;
  const sample = Array.isArray(p?.sample) ? (p!.sample as string[][]) : [];
  return { header, sample };
}
