import "server-only";
import { createHash } from "node:crypto";
import { Prisma, type ImportFormat } from "@prisma/client";
import { addDays, fromISODate, toISODate } from "@/lib/dates";
import { fingerprint, normalizeDescription } from "@/lib/fingerprint";
import { db, forUser, type UserDb } from "@/server/db";
import { categorizeCascade, categorizeWithLlm } from "@/server/services/categorize";
import { NotFoundError } from "@/server/services/transactions";
import { createAiClient, type AiClient, type BankHint } from "@/ai/client";
import { importLlmCategorizationEnabled } from "@/ai/models";
import { classifyRow, markExistingTransfers, suggestCounterAccount, TRANSFER_MATCH_DAYS, type ExistingTransfer } from "./card-credits";
import { dedupeRows, type ExistingTx } from "./dedupe";
import { parseCsv, previewCsv } from "./parsers/csv";
import { decodeOfx, parseOfx } from "./parsers/ofx";
import { parsePdf } from "./parsers/pdf";
import { csvMappingSchema, reviewRowSchema, type CsvMapping, type ParseResult, type ReviewRow } from "./types";

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export const formatFromName = (fileName: string): ImportFormat | null => {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "ofx" || ext === "qfx") return "OFX";
  if (ext === "csv" || ext === "txt") return "CSV";
  if (ext === "xlsx" || ext === "xls") return "XLSX";
  if (ext === "pdf") return "PDF";
  return null;
};

export type StartImportInput = {
  accountId: string;
  fileName: string;
  storageKey: string;
  format: ImportFormat;
  bytes: Uint8Array;
};

/** Cria o lote em PENDING. O processamento é disparado fora (fila ou pós-resposta). */
export async function startImport(tx: UserDb, userId: string, input: StartImportInput) {
  const account = await tx.account.findFirst({ where: { id: input.accountId, userId } });
  if (!account) throw new NotFoundError("Conta");
  // O mesmo arquivo duas vezes só gera duplicata para a pessoa limpar: avisa antes, apontando o lote.
  const contentHash = sha256(input.bytes);
  const sameFile = await tx.importBatch.findFirst({
    where: { userId, accountId: input.accountId, contentHash, status: { in: ["PENDING", "PROCESSING", "READY_FOR_REVIEW", "NEEDS_MAPPING", "CONFIRMED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (sameFile) {
    throw new ImportError(
      sameFile.status === "CONFIRMED"
        ? "Este arquivo já foi importado nesta conta. Se quiser importar de novo, desfaça a importação anterior primeiro."
        : "Este arquivo já está em importação nesta conta. Abra o lote na lista abaixo para revisar, ou cancele-o antes de enviar de novo.",
    );
  }
  return tx.importBatch.create({
    data: {
      userId,
      accountId: input.accountId,
      fileName: input.fileName,
      storageKey: input.storageKey,
      contentHash,
      format: input.format,
      status: "PENDING",
    },
  });
}

export type ProcessDeps = { ai?: AiClient | null };

type ParseContext = { mapping: CsvMapping | null; userId: string; hint: BankHint; ai: () => AiClient };

/** Leitura por formato: OFX e CSV determinísticos; PDF pelo modelo (texto redigido ou imagem). XLSX fica para depois. */
async function parseFile(format: ImportFormat, bytes: Uint8Array, ctx: ParseContext): Promise<{ result: ParseResult | null; needsMapping: boolean; preview?: ReturnType<typeof previewCsv> }> {
  if (format === "OFX") return { result: parseOfx(decodeOfx(bytes)), needsMapping: false };
  if (format === "CSV") {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const preview = previewCsv(text);
    const effective = ctx.mapping ?? preview.guess;
    if (!effective) return { result: null, needsMapping: true, preview };
    return { result: parseCsv(text, effective), needsMapping: false, preview };
  }
  if (format === "PDF") return { result: await parsePdf(bytes, { ai: ctx.ai(), userId: ctx.userId, hint: ctx.hint }), needsMapping: false };
  throw new ImportError(`Formato ${format} ainda não é suportado nesta versão.`);
}

/**
 * Processa um lote: parser → dedup (3 níveis) → conciliação com previsões →
 * sugestão de categoria pela memória de comerciante → validação de saldo →
 * READY_FOR_REVIEW (ou NEEDS_MAPPING para CSV irreconhecível). Nunca cria transação.
 */
export async function processImportBatch(batchId: string, bytes: Uint8Array, mapping: CsvMapping | null = null, deps: ProcessDeps = {}) {
  const batch = await db.importBatch.findUnique({ where: { id: batchId }, include: { account: { select: { type: true, institution: true, name: true } } } });
  if (!batch) throw new NotFoundError("Lote");
  const userId = batch.userId;

  await db.importBatch.update({ where: { id: batchId }, data: { status: "PROCESSING", error: null } });

  try {
    const parsed = await parseFile(batch.format, bytes, {
      mapping,
      userId,
      hint: { accountType: batch.account.type, institution: batch.account.institution },
      ai: () => deps.ai ?? createAiClient(),
    });
    if (parsed.needsMapping || !parsed.result) {
      await db.importBatch.update({
        where: { id: batchId },
        data: { status: "NEEDS_MAPPING", rows: [], columnMapping: parsed.preview ? { preview: parsed.preview } : Prisma.JsonNull },
      });
      return;
    }
    const { rows: parsedRows, declaredClosingBalance, declaredOpeningBalance = null, warnings, fieldConfidence, aiCostCents = 0 } = parsed.result;

    const reviewRows = await forUser(userId, async (tx) => {
      const dates = parsedRows.map((r) => r.date).sort();
      const existing: ExistingTx[] = parsedRows.length
        ? (
            await tx.transaction.findMany({
              where: {
                userId,
                accountId: batch.accountId,
                competenceDate: { gte: fromISODate(addDays(dates[0], -3)), lte: fromISODate(addDays(dates[dates.length - 1], 3)) },
              },
              select: { id: true, externalId: true, fingerprint: true, competenceDate: true, amount: true, description: true, status: true },
            })
          ).map((t) => ({ ...t, competenceDate: toISODate(t.competenceDate), amount: t.amount.toString() }))
        : [];

      const dedupedPlain = dedupeRows(parsedRows, existing, { accountId: batch.accountId });

      // Pagamento de fatura e crédito do cartão não são receita/despesa: marca o tipo da linha, sugere a
      // outra conta e descarta o que o extrato da outra conta já registrou como transferência.
      const accounts = await tx.account.findMany({ where: { userId, archived: false }, select: { id: true, type: true, institution: true, name: true } });
      const counter = suggestCounterAccount({ id: batch.accountId, ...batch.account }, accounts);
      const classified = dedupedPlain.map((r) => {
        if (r.status === "duplicate") return r;
        const kind = classifyRow({ description: r.description, amount: r.amount, accountType: batch.account.type });
        if (!kind) return r;
        return { ...r, kind, counterAccountId: kind === "transfer" ? counter : null };
      });
      const existingTransfers: ExistingTransfer[] = classified.some((r) => r.kind === "transfer")
        ? (
            await tx.transaction.findMany({
              where: {
                userId,
                type: "TRANSFER",
                status: { in: ["CONFIRMED", "RECONCILED"] },
                OR: [{ accountId: batch.accountId }, { transferAccountId: batch.accountId }],
                competenceDate: { gte: fromISODate(addDays(dates[0], -TRANSFER_MATCH_DAYS)), lte: fromISODate(addDays(dates[dates.length - 1], TRANSFER_MATCH_DAYS)) },
              },
              select: { id: true, accountId: true, transferAccountId: true, amount: true, competenceDate: true },
            })
          ).map((t) => ({ id: t.id, accountId: t.accountId, transferAccountId: t.transferAccountId!, amountAbs: (t.amount < 0n ? -t.amount : t.amount).toString(), date: toISODate(t.competenceDate) }))
        : [];
      const deduped = markExistingTransfers(classified, existingTransfers, batch.accountId);

      // Categorização determinística (regra → memória → vizinhos). O nível LLM fica de fora de
      // propósito: aqui dentro há uma transação aberta, com teto de 60 s, e uma chamada de rede
      // seguraria a conexão do pooler e poderia estourar esse teto. Ele roda depois do commit.
      const candidates = deduped.filter((r) => r.status !== "duplicate" && r.kind !== "transfer");
      const results = await categorizeCascade(
        tx,
        userId,
        candidates.map((r, index) => ({ index, description: r.description, amount: r.amount, date: r.date })),
        { ai: null },
      );
      const byKey = new Map(candidates.map((r, index) => [r.key, results[index]]));
      return deduped.map((r) => {
        const hit = byKey.get(r.key);
        return hit?.categoryId ? { ...r, suggestedCategoryId: hit.categoryId, confidence: hit.confidence } : r;
      });
    });

    // Confiança por campo (leitura por IA) acompanha a linha; a dedup preserva a ordem do arquivo.
    const rowsWithConfidence = fieldConfidence
      ? reviewRows.map((r, i) => (fieldConfidence[i] ? { ...r, fieldConfidence: fieldConfidence[i] } : r))
      : reviewRows;

    // Validação de saldo, obrigatória e em código, nunca no modelo:
    // com abertura e fechamento declarados, abertura + soma dos lançamentos = fechamento;
    // só com fechamento, o saldo atual da conta mais o que entra deve bater com ele.
    let balanceDiff: bigint | null = null;
    if (declaredClosingBalance !== null) {
      if (declaredOpeningBalance !== null) {
        const total = parsedRows.reduce((s, r) => s + BigInt(r.amount), 0n);
        balanceDiff = declaredClosingBalance - (declaredOpeningBalance + total);
      } else {
        const account = await db.account.findUniqueOrThrow({ where: { id: batch.accountId } });
        const incoming = reviewRows.filter((r) => r.status === "new" || r.status === "matched").reduce((s, r) => s + BigInt(r.amount), 0n);
        balanceDiff = declaredClosingBalance - (account.currentBalance + incoming);
      }
    }

    await db.importBatch.update({
      where: { id: batchId },
      data: {
        status: "READY_FOR_REVIEW",
        rows: rowsWithConfidence,
        columnMapping: mapping ?? (parsed.preview?.guess ? parsed.preview.guess : Prisma.JsonNull),
        readCount: parsedRows.length,
        duplicateCount: reviewRows.filter((r) => r.status === "duplicate").length,
        errorCount: warnings.length,
        declaredOpeningBalance,
        declaredClosingBalance,
        balanceDiff,
        aiCostCents: Math.ceil(aiCostCents),
        error: warnings.length ? warnings.slice(0, 20).join("\n") : null,
        parserVersion: `${batch.format.toLowerCase()}-1`,
      },
    });

    // Enriquecimento opcional por LLM, depois do lote já estar pronto: nunca o invalida. "ai" in deps
    // distingue "não informado" (usa o padrão) de "null explícito" (desliga, como os testes de OFX/CSV
    // fazem para nunca gastar chamada real por engano).
    const ai = "ai" in deps ? deps.ai! : importLlmCategorizationEnabled() ? createAiClient() : null;
    if (ai) {
      try {
        await suggestRemainingWithLlm(batchId, userId, ai);
      } catch (e) {
        console.warn("[import] categorização por LLM falhou; lote mantido em revisão:", e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    await db.importBatch.update({
      where: { id: batchId },
      data: { status: "FAILED", error: e instanceof Error ? e.message : "Falha ao ler o arquivo." },
    });
    throw e;
  }
}

/**
 * Sugere categoria por LLM só para as linhas que a cascata determinística deixou em branco. Roda fora
 * de transação e depois do commit; só mexe em lote ainda em revisão — se a pessoa confirmou enquanto
 * a IA respondia, a escrita condicional simplesmente não acontece.
 */
async function suggestRemainingWithLlm(batchId: string, userId: string, ai: AiClient) {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.status !== "READY_FOR_REVIEW") return;
  const rows = readReviewRows(batch);
  const pending = rows.map((r, index) => ({ r, index })).filter(({ r }) => r.status !== "duplicate" && !r.suggestedCategoryId);
  if (!pending.length) return;

  const categories = await forUser(userId, (tx) => tx.category.findMany({ where: { userId }, select: { id: true, name: true, type: true } }));
  const found = await categorizeWithLlm(
    ai,
    userId,
    pending.map(({ r, index }) => ({ index, description: r.description, amount: r.amount, date: r.date })),
    categories,
  );
  if (!found.length) return;

  const byIndex = new Map(found.map((f) => [f.index, f]));
  const merged = rows.map((r, index) => {
    const hit = byIndex.get(index);
    return hit?.categoryId ? { ...r, suggestedCategoryId: hit.categoryId, confidence: hit.confidence } : r;
  });
  await db.importBatch.updateMany({ where: { id: batchId, status: "READY_FOR_REVIEW" }, data: { rows: merged } });
}

export function readReviewRows(batch: { rows: Prisma.JsonValue }): ReviewRow[] {
  const parsed = reviewRowSchema.array().safeParse(batch.rows);
  return parsed.success ? parsed.data : [];
}

export function readMapping(batch: { columnMapping: Prisma.JsonValue }): CsvMapping | null {
  const parsed = csvMappingSchema.safeParse(batch.columnMapping);
  return parsed.success ? parsed.data : null;
}

export type AcceptedRow = { key: string; categoryId: string | null; /** Outra conta de um pagamento de fatura, escolhida na revisão. */ counterAccountId?: string | null };

/**
 * Confirma o lote numa transação de banco só: linhas novas viram transações
 * (source IMPORT, descrição original preservada), linhas casadas efetivam a
 * previsão existente, duplicatas nunca entram. Parcial é proibido: qualquer
 * conflito de fingerprint aborta tudo.
 */
export async function confirmImport(tx: UserDb, userId: string, batchId: string, accepted: AcceptedRow[]) {
  const batch = await tx.importBatch.findFirst({ where: { id: batchId, userId } });
  if (!batch) throw new NotFoundError("Lote");
  if (batch.status !== "READY_FOR_REVIEW") throw new ImportError("Este lote não está em revisão.");

  const rows = readReviewRows(batch);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const chosen = accepted.map((a) => ({ a, row: byKey.get(a.key) })).filter((x): x is { a: AcceptedRow; row: ReviewRow } => Boolean(x.row));
  if (chosen.some((c) => c.row.status === "duplicate")) throw new ImportError("Duplicata exata não pode ser importada.");

  // Operações em bloco: em produção cada ida ao banco custa ~130 ms (function nos EUA, banco em São
  // Paulo), e uma criação por linha levava 17 s só em teste local — acima dos 30 s da Netlify numa
  // fatura de 72 linhas, o que derrubava a aprovação.
  const isTransfer = (c: (typeof chosen)[number]) => c.row.kind === "transfer";
  const matchedRows = chosen.filter((c) => !isTransfer(c) && c.row.status === "matched" && c.row.matchId);
  const newRows = chosen.filter((c) => !matchedRows.includes(c));
  const created = newRows.length;
  const matched = matchedRows.length;

  // Pagamento de fatura vira transferência entre duas contas (uma linha só): a conta de origem é a
  // que perde o dinheiro. Num lote de cartão a linha é positiva e a origem é a corrente escolhida;
  // num lote de corrente a linha é negativa e a origem é a própria conta do lote.
  const counterIds = new Set(chosen.filter(isTransfer).map((c) => c.a.counterAccountId ?? c.row.counterAccountId ?? null));
  if (counterIds.has(null)) throw new ImportError("Escolha a outra conta de cada pagamento de fatura antes de aprovar.");
  if (counterIds.size) {
    const owned = await tx.account.count({ where: { userId, id: { in: Array.from(counterIds) as string[] } } });
    if (owned !== counterIds.size) throw new ImportError("A outra conta do pagamento não foi encontrada.");
  }

  try {
    for (const { a, row } of matchedRows) {
      await tx.transaction.update({
        where: { id: row.matchId! },
        data: {
          status: "CONFIRMED",
          competenceDate: fromISODate(row.date),
          externalId: row.externalId,
          originalDesc: row.description,
          importBatchId: batchId,
          reviewed: true,
          ...(a.categoryId ? { categoryId: a.categoryId } : {}),
        },
      });
    }
    if (newRows.length) {
      await tx.transaction.createMany({
        data: newRows.map(({ a, row }) => {
          const amount = BigInt(row.amount);
          const common = {
            userId,
            competenceDate: fromISODate(row.date),
            description: row.description,
            originalDesc: row.description,
            notes: row.memo,
            status: "CONFIRMED" as const,
            source: "IMPORT" as const,
            externalId: row.externalId,
            importBatchId: batchId,
            reviewed: true,
          };
          if (row.kind === "transfer") {
            const counterId = (a.counterAccountId ?? row.counterAccountId)!;
            const outflow = amount < 0n ? -amount : amount;
            const [from, to] = amount > 0n ? [counterId, batch.accountId] : [batch.accountId, counterId];
            return {
              ...common,
              accountId: from,
              transferAccountId: to,
              categoryId: null,
              amount: -outflow,
              type: "TRANSFER" as const,
              isRefund: false,
              fingerprint: fingerprint({ accountId: from, competenceDate: row.date, amount: -outflow, description: row.description }),
            };
          }
          return {
            ...common,
            accountId: batch.accountId,
            transferAccountId: null,
            categoryId: a.categoryId ?? row.suggestedCategoryId ?? null,
            amount,
            type: amount >= 0n ? ("INCOME" as const) : ("EXPENSE" as const),
            // Estorno, cashback e pontos entram como crédito, mas abatem despesa em vez de contar como receita.
            isRefund: row.kind === "refund" && amount > 0n,
            fingerprint: fingerprint({ accountId: batch.accountId, competenceDate: row.date, amount, description: row.description }),
          };
        }),
      });
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ImportError("Um dos lançamentos já existe na conta. Nada foi importado; revise as duplicatas.");
    }
    throw e;
  }

  // Memória de comerciante numa instrução só: vale a última categoria escolhida por descrição e cada
  // ocorrência soma um acerto (a primeira cria com 1).
  const remembered = new Map<string, { categoryId: string; n: number }>();
  for (const { a, row } of chosen) {
    if (!a.categoryId || row.status === "duplicate" || row.kind === "transfer") continue;
    const normalizedDesc = normalizeDescription(row.description);
    if (!normalizedDesc) continue;
    remembered.set(normalizedDesc, { categoryId: a.categoryId, n: (remembered.get(normalizedDesc)?.n ?? 0) + 1 });
  }
  if (remembered.size) {
    const entries = Array.from(remembered, ([normalizedDesc, v]) => ({ d: normalizedDesc, c: v.categoryId, n: v.n }));
    await tx.$executeRaw`
      insert into public.merchant_memory (id, user_id, normalized_desc, category_id, hit_count, updated_at)
      select gen_random_uuid()::text, ${userId}::uuid, x.d, x.c, x.n, now()
      from jsonb_to_recordset(${JSON.stringify(entries)}::jsonb) as x(d text, c text, n int)
      on conflict (user_id, normalized_desc)
      do update set category_id = excluded.category_id, hit_count = public.merchant_memory.hit_count + excluded.hit_count, updated_at = now()
    `;
  }

  await tx.auditLog.create({ data: { userId, entity: "import_batch", entityId: batchId, action: "CREATE", source: "IMPORT", diff: { created, matched } } });
  return tx.importBatch.update({
    where: { id: batchId },
    data: { status: "CONFIRMED", createdCount: created + matched },
  });
}

/** Remove tudo que o lote criou e devolve previsões casadas ao estado anterior. */
export async function undoImport(tx: UserDb, userId: string, batchId: string) {
  const batch = await tx.importBatch.findFirst({ where: { id: batchId, userId } });
  if (!batch) throw new NotFoundError("Lote");
  if (batch.status !== "CONFIRMED") throw new ImportError("Só um lote confirmado pode ser desfeito.");

  const removed = await tx.transaction.deleteMany({ where: { userId, importBatchId: batchId, source: "IMPORT" } });
  const reverted = await tx.transaction.updateMany({
    where: { userId, importBatchId: batchId, source: { not: "IMPORT" } },
    // original_desc é imutável por trigger: a descrição do banco fica, o resto volta.
    data: { status: "PROJECTED", externalId: null, importBatchId: null },
  });
  await tx.auditLog.create({ data: { userId, entity: "import_batch", entityId: batchId, action: "UNDO_IMPORT", source: "IMPORT", diff: { removed: removed.count, reverted: reverted.count } } });
  return tx.importBatch.update({ where: { id: batchId }, data: { status: "UNDONE" } });
}
