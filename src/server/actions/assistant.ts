"use server";

import { z } from "zod";
import { answerQuestion, type Answer } from "@/ai/assistant";
import { requireUserId } from "@/server/auth";
import type { ActionResult } from "./transactions";

const KNOWN = ["BudgetExceededError", "RateLimitedError", "ProviderUnavailableError"];

const schema = z.object({
  question: z.string().trim().min(1).max(500),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).max(16).default([]),
});

export async function askAssistantAction(payload: unknown): Promise<ActionResult<Answer>> {
  const userId = await requireUserId();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: "Pergunta inválida." };
  try {
    const answer = await answerQuestion({ userId, question: parsed.data.question, history: parsed.data.history });
    return { ok: true, data: answer };
  } catch (e) {
    if (e instanceof Error && KNOWN.includes(e.name)) return { ok: false, message: e.message };
    console.error(e);
    return { ok: false, message: "Não consegui responder agora. Tente de novo em instantes." };
  }
}
