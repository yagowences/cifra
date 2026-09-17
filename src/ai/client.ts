import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { db } from "@/server/db";
import { costCents, monthlyBudgetCents } from "./cost";
import { MODELS } from "./models";
import type { LlmProvider, ProviderContent } from "./provider";
import { AI_PROVIDER } from "./models";
import { AnthropicProvider } from "./providers/anthropic";
import { GeminiProvider } from "./providers/gemini";
import { redactPII } from "./redact";
import { categorizedSchema, type Categorized } from "./schemas/categorize";
import { receiptSchema, type Receipt } from "./schemas/receipt";
import { statementExtractionSchema, type StatementExtraction } from "./schemas/statement";

export class ManualReviewError extends Error {
  constructor(
    public readonly task: string,
    public readonly reason: string,
    public readonly rawOutput: string | null,
  ) {
    super(`A IA não devolveu um resultado válido para ${task}; vai para revisão manual. ${reason}`);
    this.name = "ManualReviewError";
  }
}

export class BudgetExceededError extends Error {
  constructor(public readonly spentCents: number, public readonly budgetCents: number) {
    super("O orçamento de IA deste mês acabou. Você ainda pode importar OFX/CSV e lançar à mão.");
    this.name = "BudgetExceededError";
  }
}

export class RateLimitedError extends Error {
  constructor() {
    super("Muitas leituras por IA em pouco tempo. Espere um minuto.");
    this.name = "RateLimitedError";
  }
}

export type Extracted<T> = {
  data: T;
  model: string;
  costCents: number;
  /** Veio do cache: nenhum token gasto. */
  cached: boolean;
};

export type FileRef = { kind: "pdf"; base64: string } | { kind: "image"; mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string } | { kind: "text"; text: string };
export type BankHint = { institution?: string | null; accountType: string };
export type TxForCategorization = { index: number; description: string; amount: string; date: string };
export type CategoryOption = { id: string; name: string; type: "INCOME" | "EXPENSE" };

export interface AiClient {
  extractStatement(userId: string, file: FileRef, hint: BankHint): Promise<Extracted<StatementExtraction>>;
  extractReceipt(userId: string, file: FileRef): Promise<Extracted<Receipt>>;
  categorize(userId: string, txs: TxForCategorization[], categories: CategoryOption[]): Promise<Extracted<Categorized>>;
}

export type AiClientOptions = {
  provider?: LlmProvider;
  /** Chamadas por minuto por usuário. */
  ratePerMinute?: number;
  now?: () => Date;
};

const RATE_PER_MINUTE = 20;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Extrai o primeiro objeto JSON do texto, tolerando cercas de código e prosa em volta. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new SyntaxError("nenhum objeto JSON no texto");
  return JSON.parse(candidate.slice(start, end + 1));
}

type JsonTask<T> = {
  userId: string;
  task: string;
  model: string;
  system: string;
  content: ProviderContent[];
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  maxTokens: number;
  /** Entrada canônica para a chave de cache. */
  cacheInput: string;
};

/** Rate limit por minuto e orçamento mensal por usuário; lança antes de gastar token. */
export async function assertAiAllowed(userId: string, opts: { ratePerMinute?: number; now?: Date } = {}) {
  const current = opts.now ?? new Date();
  const ratePerMinute = opts.ratePerMinute ?? RATE_PER_MINUTE;
  const minuteAgo = new Date(current.getTime() - 60_000);
  const recent = await db.aiUsageLog.count({ where: { userId, createdAt: { gte: minuteAgo } } });
  if (recent >= ratePerMinute) throw new RateLimitedError();

  const monthStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
  const spent = await db.aiUsageLog.aggregate({ where: { userId, createdAt: { gte: monthStart } }, _sum: { costCents: true } });
  const spentCents = spent._sum.costCents ?? 0;
  const budget = monthlyBudgetCents();
  if (spentCents >= budget) {
    console.warn(`[ai] usuário ${userId} passou do orçamento: ${spentCents}/${budget} centavos`);
    throw new BudgetExceededError(spentCents, budget);
  }
}

export type UsageEntry = { userId: string; task: string; model: string; inputTokens: number; outputTokens: number; costCents: number; latencyMs: number; success: boolean; error: string | null };

export function logAiUsage(entry: UsageEntry) {
  return db.aiUsageLog.create({ data: entry });
}

export function createAiClient(opts: AiClientOptions = {}): AiClient {
  const provider = opts.provider ?? (AI_PROVIDER === "anthropic" ? new AnthropicProvider() : new GeminiProvider());
  const ratePerMinute = opts.ratePerMinute ?? RATE_PER_MINUTE;
  const now = opts.now ?? (() => new Date());

  const guard = (userId: string) => assertAiAllowed(userId, { ratePerMinute, now: now() });

  /**
   * Núcleo: cache → chamada → JSON → Zod. Saída inválida faz um retry com o
   * erro no prompt; falhou duas vezes, ManualReviewError. Toda chamada é logada.
   */
  async function runJson<T>(spec: JsonTask<T>): Promise<Extracted<T>> {
    const key = `${spec.task}|${spec.model}|${sha256(spec.cacheInput)}`;
    const hit = await db.aiCache.findUnique({ where: { key } });
    if (hit) {
      const parsed = spec.schema.safeParse(hit.output);
      if (parsed.success) return { data: parsed.data, model: hit.model, costCents: 0, cached: true };
    }

    await guard(spec.userId);

    let content = spec.content;
    let lastError = "";
    let lastRaw: string | null = null;
    let totalCost = 0;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const startedAt = Date.now();
      let text = "";
      let model = spec.model;
      let success = false;
      let error: string | null = null;
      let inputTokens = 0;
      let outputTokens = 0;
      try {
        const res = await provider.complete({ model: spec.model, system: spec.system, content, maxTokens: spec.maxTokens });
        text = res.text;
        model = res.model;
        inputTokens = res.inputTokens;
        outputTokens = res.outputTokens;
        lastRaw = text;
        const parsed = spec.schema.safeParse(extractJson(text));
        if (parsed.success) {
          success = true;
          const cost = costCents(spec.model, inputTokens, outputTokens);
          totalCost += cost;
          await log(spec, model, inputTokens, outputTokens, cost, startedAt, true, null);
          await db.aiCache.upsert({
            where: { key },
            create: { key, userId: spec.userId, task: spec.task, model, output: parsed.data as Prisma.InputJsonValue },
            update: { output: parsed.data as Prisma.InputJsonValue, model },
          });
          return { data: parsed.data, model, costCents: totalCost, cached: false };
        }
        error = parsed.error.issues.map((i) => `${i.path.join(".") || "raiz"}: ${i.message}`).join("; ");
      } catch (e) {
        if (e instanceof SyntaxError) error = `JSON inválido: ${e.message}`;
        else {
          await log(spec, model, inputTokens, outputTokens, 0, startedAt, false, e instanceof Error ? e.message : String(e));
          throw e;
        }
      }
      if (!success) {
        const cost = costCents(spec.model, inputTokens, outputTokens);
        totalCost += cost;
        await log(spec, model, inputTokens, outputTokens, cost, startedAt, false, error);
        lastError = error ?? "saída inválida";
        // Retry com o erro no prompt, uma vez só.
        content = [
          ...spec.content,
          {
            type: "text",
            text: `Sua resposta anterior não passou na validação: ${lastError}. Responda de novo só com o JSON, corrigindo isso.`,
          },
        ];
      }
    }
    throw new ManualReviewError(spec.task, lastError, lastRaw);
  }

  async function log(spec: JsonTask<unknown>, model: string, inputTokens: number, outputTokens: number, cost: number, startedAt: number, success: boolean, error: string | null) {
    await db.aiUsageLog.create({
      data: { userId: spec.userId, task: spec.task, model, inputTokens, outputTokens, costCents: cost, latencyMs: Date.now() - startedAt, success, error },
    });
  }

  const fileContent = (file: FileRef): { content: ProviderContent[]; cacheInput: string } => {
    if (file.kind === "text") {
      const { text } = redactPII(file.text);
      return { content: [{ type: "text", text }], cacheInput: text };
    }
    if (file.kind === "pdf") return { content: [{ type: "pdf", base64: file.base64 }], cacheInput: file.base64 };
    return { content: [{ type: "image", mediaType: file.mediaType, base64: file.base64 }], cacheInput: file.base64 };
  };

  return {
    async extractStatement(userId, file, hint) {
      const { content, cacheInput } = fileContent(file);
      return runJson({
        userId,
        task: "extractStatement",
        model: MODELS.extract,
        maxTokens: 16000,
        schema: statementExtractionSchema,
        cacheInput: `${hint.accountType}|${hint.institution ?? ""}|${cacheInput}`,
        system: STATEMENT_SYSTEM(hint),
        content: [...content, { type: "text", text: "Extraia os lançamentos deste extrato. Responda só com o JSON." }],
      });
    },

    async extractReceipt(userId, file) {
      const { content, cacheInput } = fileContent(file);
      return runJson({
        userId,
        task: "extractReceipt",
        model: MODELS.extract,
        maxTokens: 4000,
        schema: receiptSchema,
        cacheInput,
        system: RECEIPT_SYSTEM,
        content: [...content, { type: "text", text: "Leia este comprovante. Responda só com o JSON." }],
      });
    },

    async categorize(userId, txs, categories) {
      const payload = { categories, transactions: txs.map((t) => ({ ...t, description: redactPII(t.description).text })) };
      const text = JSON.stringify(payload);
      return runJson({
        userId,
        task: "categorize",
        model: MODELS.categorize,
        maxTokens: 4000,
        schema: categorizedSchema,
        cacheInput: text,
        system: CATEGORIZE_SYSTEM,
        content: [{ type: "text", text }],
      });
    },
  };
}

const STATEMENT_SYSTEM = (hint: BankHint) => `Você lê extratos bancários brasileiros e devolve os lançamentos em JSON estrito. Não calcule nada: só transcreva o que está escrito.
Conta: ${hint.accountType}${hint.institution ? ` (${hint.institution})` : ""}.
Formato exato:
{"rows":[{"date":"YYYY-MM-DD","amount":<inteiro em centavos, negativo para saída>,"description":"<texto como no extrato>","balanceAfter":<inteiro em centavos ou null>,"confidence":{"date":0-1,"amount":0-1,"description":0-1}}],"openingBalance":<centavos ou null>,"closingBalance":<centavos ou null>,"unreadablePages":[<números de página ilegíveis>]}
Regras: valores em centavos inteiros (R$ 48,90 → 4890); saída negativa, entrada positiva; confiança honesta, nunca 1.0 quando houver dúvida; página ilegível vai em unreadablePages e o resto continua. Nenhum texto fora do JSON.`;

const RECEIPT_SYSTEM = `Você lê comprovantes e notas de compra brasileiros e devolve JSON estrito.
Formato exato:
{"amount":<total em centavos, positivo>,"date":"YYYY-MM-DD","merchant":"<nome tratado do estabelecimento, não a razão social>","paymentMethod":"credit|debit|pix|cash|unknown","cardLast4":"<4 dígitos ou null>","suggestedCategory":"<uma palavra em português ou null>","items":[{"description":"...","amount":<centavos ou null>}],"confidence":{"amount":0-1,"date":0-1,"merchant":0-1}}
Confiança honesta, nunca 1.0. Nenhum texto fora do JSON.`;

const CATEGORIZE_SYSTEM = `Você categoriza transações financeiras usando SOMENTE as categorias fornecidas (pelo id). Devolva JSON estrito:
{"results":[{"index":<índice da transação>,"categoryId":"<id existente ou null>","confidence":0-1}]}
Uma entrada por transação recebida. Se nenhuma categoria servir, categoryId null. Nenhum texto fora do JSON.`;
