"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/server/auth";
import { forUser } from "@/server/db";
import { categorizeCascade, createRule, ruleConditionsSchema, ruleSuggestionFor } from "@/server/services/categorize";
import type { ActionResult } from "./transactions";

const revalidate = () => ["/regras", "/transacoes"].forEach((p) => revalidatePath(p));

export type CategorySuggestion = { categoryId: string; confidence: number; source: "rule" | "memory" | "knn" } | null;

/** Sugestão barata (níveis 1–3, sem LLM) para o lançamento rápido, enquanto a pessoa digita. */
export async function suggestCategoryAction(description: string, type: "INCOME" | "EXPENSE"): Promise<CategorySuggestion> {
  const userId = await requireUserId();
  const text = description.trim();
  if (text.length < 3) return null;
  const [result] = await forUser(userId, (tx) => categorizeCascade(tx, userId, [{ index: 0, description: text, amount: type === "INCOME" ? "1" : "-1" }], { ai: null }));
  if (!result?.categoryId || !result.source || result.source === "llm") return null;
  return { categoryId: result.categoryId, confidence: result.confidence, source: result.source };
}

export type RuleSuggestion = { normalizedDesc: string; categoryId: string; categoryName: string } | null;

/** Depois de uma correção: a mesma escolha se repetiu três vezes? Então vale virar regra. */
export async function ruleSuggestionAction(description: string): Promise<RuleSuggestion> {
  const userId = await requireUserId();
  return forUser(userId, (tx) => ruleSuggestionFor(tx, userId, description));
}

const createRuleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  conditions: ruleConditionsSchema,
  categoryId: z.string().min(1),
});

export async function createRuleAction(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const userId = await requireUserId();
  const parsed = createRuleSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: "Regra inválida." };
  try {
    const rule = await forUser(userId, (tx) => createRule(tx, userId, parsed.data));
    revalidate();
    return { ok: true, data: { id: rule.id } };
  } catch (e) {
    console.error(e);
    return { ok: false, message: "Não consegui salvar a regra." };
  }
}

export async function setRuleActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const userId = await requireUserId();
  await forUser(userId, (tx) => tx.automationRule.updateMany({ where: { id, userId }, data: { active } }));
  revalidate();
  return { ok: true, data: undefined };
}

export async function deleteRuleAction(id: string): Promise<ActionResult> {
  const userId = await requireUserId();
  await forUser(userId, (tx) => tx.automationRule.deleteMany({ where: { id, userId } }));
  revalidate();
  return { ok: true, data: undefined };
}
