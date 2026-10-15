import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AiClient, CategoryOption } from "@/ai/client";
import { normalizeDescription } from "@/lib/fingerprint";
import type { UserDb } from "@/server/db";

export type CategorizeItem = { index: number; description: string; amount: string; date?: string };
export type CategorizeSource = "rule" | "memory" | "knn" | "llm";
export type CategorizeResult = { index: number; categoryId: string | null; confidence: number; source: CategorizeSource | null };

/** Condições de uma regra explícita; todas as informadas precisam bater. */
export const ruleConditionsSchema = z.object({
  /** Algum destes trechos na descrição normalizada. */
  descriptionContains: z.array(z.string().min(1)).min(1),
  /** Faixa de magnitude em centavos (strings decimais). */
  amountMin: z.string().regex(/^\d+$/).optional(),
  amountMax: z.string().regex(/^\d+$/).optional(),
  type: z.enum(["INCOME", "EXPENSE"]).optional(),
});
export const ruleActionsSchema = z.object({ categoryId: z.string().min(1) });

export type RuleConditions = z.infer<typeof ruleConditionsSchema>;

export function ruleMatches(conditions: RuleConditions, item: { description: string; amount: bigint }): boolean {
  const desc = normalizeDescription(item.description);
  if (!conditions.descriptionContains.some((s) => desc.includes(normalizeDescription(s)))) return false;
  const magnitude = item.amount < 0n ? -item.amount : item.amount;
  if (conditions.amountMin && magnitude < BigInt(conditions.amountMin)) return false;
  if (conditions.amountMax && magnitude > BigInt(conditions.amountMax)) return false;
  if (conditions.type && (item.amount >= 0n ? "INCOME" : "EXPENSE") !== conditions.type) return false;
  return true;
}

const KNN_THRESHOLD = 0.45;
const LLM_BATCH = 50;

/**
 * Categorização em cascata, da etapa mais barata para a mais cara, parando na
 * primeira que resolve: regra explícita → memória de comerciante → vizinhos no
 * histórico (trigramas) → LLM em lote. `ai` nulo pula a última etapa.
 */
export async function categorizeCascade(
  tx: UserDb,
  userId: string,
  items: CategorizeItem[],
  opts: { ai?: AiClient | null; knnThreshold?: number } = {},
): Promise<CategorizeResult[]> {
  const results = new Map<number, CategorizeResult>();
  const pending = new Set(items.map((i) => i.index));
  const byIndex = new Map(items.map((i) => [i.index, i]));
  const resolve = (index: number, categoryId: string, confidence: number, source: CategorizeSource) => {
    results.set(index, { index, categoryId, confidence, source });
    pending.delete(index);
  };

  // 1. Regras explícitas do usuário: determinístico, custo zero.
  const rules = await tx.automationRule.findMany({ where: { userId, active: true }, orderBy: { priority: "asc" } });
  const parsedRules = rules
    .map((r) => ({ id: r.id, conditions: ruleConditionsSchema.safeParse(r.conditions), actions: ruleActionsSchema.safeParse(r.actions) }))
    .filter((r) => r.conditions.success && r.actions.success);
  if (parsedRules.length) {
    const hits: string[] = [];
    for (const index of Array.from(pending)) {
      const item = byIndex.get(index)!;
      const rule = parsedRules.find((r) => r.conditions.success && ruleMatches(r.conditions.data, { description: item.description, amount: BigInt(item.amount) }));
      if (rule && rule.actions.success) {
        resolve(index, rule.actions.data.categoryId, 1, "rule");
        hits.push(rule.id);
      }
    }
    if (hits.length) await tx.automationRule.updateMany({ where: { id: { in: hits } }, data: { hitCount: { increment: 1 } } });
  }

  // 2. Memória: esta descrição normalizada já foi categorizada por este usuário.
  if (pending.size) {
    const keys = Array.from(new Set(Array.from(pending).map((i) => normalizeDescription(byIndex.get(i)!.description)).filter(Boolean)));
    const memory = keys.length ? await tx.merchantMemory.findMany({ where: { userId, normalizedDesc: { in: keys } } }) : [];
    const byDesc = new Map(memory.map((m) => [m.normalizedDesc, m]));
    for (const index of Array.from(pending)) {
      const hit = byDesc.get(normalizeDescription(byIndex.get(index)!.description));
      if (hit) resolve(index, hit.categoryId, hit.hitCount >= 3 ? 0.95 : 0.85, "memory");
    }
  }

  // 3. Vizinhos no histórico do próprio usuário, por similaridade de trigramas. Uma consulta só para
  // todos os pendentes: em produção cada ida ao banco custa ~130 ms (a function fica nos EUA, o banco
  // em São Paulo), e uma consulta por linha estourava o limite de 30 s da Netlify numa fatura de 72 linhas.
  if (pending.size) {
    const threshold = opts.knnThreshold ?? KNN_THRESHOLD;
    const queries = Array.from(pending).flatMap((index) => {
      const item = byIndex.get(index)!;
      const q = normalizeDescription(item.description);
      if (!q) return [];
      // Palavras significativas do que chegou: "cinemark flamboyant" ainda casa com "cinemark".
      const tokens = q.split(" ").filter((t) => t.length >= 4 && !/^\d+$/.test(t));
      return [{ idx: index, q, kind: item.amount.startsWith("-") ? "EXPENSE" : "INCOME", tokens }];
    });
    if (queries.length) {
      const rows = await tx.$queryRaw<{ idx: number; category_id: string; score: number }[]>`
        with q as (
          select * from jsonb_to_recordset(${JSON.stringify(queries)}::jsonb) as x(idx int, q text, kind text, tokens text[])
        ),
        hist as (
          select q.idx, t.category_id,
            extensions.similarity(lower(t.description), q.q) as sim,
            (regexp_split_to_array(lower(t.description), '[^a-z0-9]+') && q.tokens) as token_hit
          from q
          join public.transactions t
            on t.user_id = ${userId}::uuid
           and t.category_id is not null
           and t.type = q.kind::public.tx_type
        ),
        agg as (
          select idx, category_id, max(greatest(sim, case when token_hit then 0.6 else 0 end))::float as score, count(*)::bigint as votes
          from hist
          where sim >= ${threshold} or token_hit
          group by idx, category_id
        )
        select distinct on (idx) idx, category_id, score
        from agg
        order by idx, score desc, votes desc
      `;
      for (const best of rows) resolve(best.idx, best.category_id, Math.min(0.9, Number(best.score)), "knn");
    }
  }

  // 4. LLM em lote, só para o que sobrou.
  if (pending.size && opts.ai) {
    const categories = await tx.category.findMany({ where: { userId }, select: { id: true, name: true, type: true } });
    const rest = Array.from(pending).map((i) => byIndex.get(i)!);
    for (const r of await categorizeWithLlm(opts.ai, userId, rest, categories)) {
      if (pending.has(r.index) && r.categoryId) resolve(r.index, r.categoryId, r.confidence, "llm");
    }
  }

  return items.map((i) => results.get(i.index) ?? { index: i.index, categoryId: null, confidence: 0, source: null });
}

/**
 * Nível 4 isolado, em lotes de LLM_BATCH. É uma etapa opcional: os níveis anteriores já resolvem a
 * maior parte, então o provedor fora do ar (503, chave, cota) não pode invalidar quem chamou. Devolve
 * o que os lotes bem-sucedidos categorizaram; no primeiro lote que falha, avisa e para — se o provedor
 * caiu, os próximos lotes cairiam também e só arrastariam a espera.
 */
export async function categorizeWithLlm(ai: AiClient, userId: string, items: CategorizeItem[], categories: CategoryOption[]): Promise<CategorizeResult[]> {
  const valid = new Set(categories.map((c) => c.id));
  const out: CategorizeResult[] = [];
  for (let start = 0; start < items.length; start += LLM_BATCH) {
    const batch = items.slice(start, start + LLM_BATCH);
    const asked = new Set(batch.map((b) => b.index));
    try {
      const res = await ai.categorize(
        userId,
        batch.map((b) => ({ index: b.index, description: b.description, amount: b.amount, date: b.date ?? "" })),
        categories,
      );
      for (const r of res.data.results) {
        if (asked.has(r.index) && r.categoryId && valid.has(r.categoryId)) out.push({ index: r.index, categoryId: r.categoryId, confidence: r.confidence, source: "llm" });
      }
    } catch (e) {
      console.warn("[categorize] nível LLM indisponível; seguindo só com o determinístico:", e instanceof Error ? e.message : e);
      break;
    }
  }
  return out;
}

/** Quando a mesma correção se repete três vezes, vale virar regra explícita. */
export async function ruleSuggestionFor(tx: UserDb, userId: string, description: string): Promise<{ normalizedDesc: string; categoryId: string; categoryName: string } | null> {
  const normalizedDesc = normalizeDescription(description);
  if (!normalizedDesc) return null;
  const memory = await tx.merchantMemory.findUnique({ where: { userId_normalizedDesc: { userId, normalizedDesc } }, include: { category: { select: { name: true } } } });
  if (!memory || memory.hitCount < 3) return null;
  const rules = await tx.automationRule.findMany({ where: { userId, active: true } });
  const covered = rules.some((r) => {
    const c = ruleConditionsSchema.safeParse(r.conditions);
    return c.success && c.data.descriptionContains.some((s) => normalizedDesc.includes(normalizeDescription(s)));
  });
  if (covered) return null;
  return { normalizedDesc, categoryId: memory.categoryId, categoryName: memory.category.name };
}

export type RuleInput = { name: string; conditions: RuleConditions; categoryId: string; priority?: number };

export async function createRule(tx: UserDb, userId: string, input: RuleInput) {
  return tx.automationRule.create({
    data: {
      userId,
      name: input.name,
      conditions: input.conditions as Prisma.InputJsonObject,
      actions: { categoryId: input.categoryId },
      priority: input.priority ?? 100,
    },
  });
}
