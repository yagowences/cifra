/**
 * Assistente com modelo falso: o loop chama a ferramenta, a ferramenta roda a
 * query real com o userId do servidor, e a resposta traz link para as transações.
 */
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, forUser } from "@/server/db";
import { createAccount } from "@/server/services/accounts";
import { createTransaction } from "@/server/services/transactions";
import { answerQuestion, executeTool, type ChatModel } from "./assistant";

const hasDb = Boolean(process.env.DATABASE_URL);
const userId = randomUUID();

class FakeChat implements ChatModel {
  calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  constructor(private script: Anthropic.Message[]) {}
  async create(params: Anthropic.MessageCreateParamsNonStreaming) {
    this.calls.push(params);
    const next = this.script.shift();
    if (!next) throw new Error("script acabou");
    return next;
  }
}

const message = (content: Anthropic.ContentBlock[], stop: Anthropic.Message["stop_reason"]): Anthropic.Message =>
  ({
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 500, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null },
  }) as unknown as Anthropic.Message;

describe.skipIf(!hasDb)("assistente", () => {
  beforeAll(async () => {
    await db.$executeRaw`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', ${userId}::uuid, 'authenticated', 'authenticated',
        ${`asst-${userId}@cifra.test`}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
    `;
    await forUser(userId, async (tx) => {
      const accountId = (await createAccount(tx, userId, { name: "Nubank", type: "CHECKING", initialBalance: 0n, institution: null })).id;
      const food = (await tx.category.findFirstOrThrow({ where: { userId, name: "Alimentação" } })).id;
      await createTransaction(tx, userId, { accountId, type: "INCOME", amount: 1_240_000n, competenceDate: "2026-09-05", description: "Salário" });
      await createTransaction(tx, userId, { accountId, type: "EXPENSE", amount: 184_000n, competenceDate: "2026-09-10", description: "Mercado", categoryId: food });
    });
  });

  afterAll(async () => {
    await db.$executeRaw`delete from auth.users where id = ${userId}::uuid`;
    await db.$disconnect();
  });

  it("ferramentas rodam as queries do dashboard e devolvem número formatado mais link", async () => {
    const summary = await executeTool(userId, "get_summary", { month: "2026-09" });
    expect(summary.result).toMatchObject({ income: "R$ 12.400,00", expense: "R$ 1.840,00", result: "R$ 10.560,00" });
    expect(summary.links[0].href).toBe("/transacoes?mes=2026-09");

    const byCat = await executeTool(userId, "get_by_category", { month: "2026-09", type: "EXPENSE", limit: 5 });
    expect((byCat.result as { categories: { name: string; total: string }[] }).categories[0]).toMatchObject({ name: "Alimentação", total: "R$ 1.840,00" });
    expect(byCat.links[0].href).toMatch(/tipo=EXPENSE&categoria=/);

    const flow = await executeTool(userId, "get_monthly_flow", { end_month: "2026-09", months: 3 });
    expect(flow.chart).toHaveLength(3);
  });

  it("o loop chama a ferramenta, redige em cima do resultado e a resposta traz o link", async () => {
    const chat = new FakeChat([
      message([{ type: "tool_use", id: "t1", name: "get_summary", input: { month: "2026-09" }, caller: { type: "direct" } } as unknown as Anthropic.ContentBlock], "tool_use"),
      message([{ type: "text", text: "Sobrou R$ 10.560,00 em setembro: entraram R$ 12.400,00 e saíram R$ 1.840,00.", citations: null }], "end_turn"),
    ]);
    const answer = await answerQuestion({ userId, question: "Quanto sobrou este mês?", today: "2026-09-17" }, { model: chat, modelId: "claude-sonnet-5" });

    expect(answer.text).toContain("10.560,00");
    expect(answer.links).toEqual([{ label: "Ver transações de setembro 2026", href: "/transacoes?mes=2026-09" }]);
    expect(answer.toolsUsed).toEqual(["get_summary"]);
    // O modelo nunca recebe o userId nem SQL.
    expect(JSON.stringify(chat.calls)).not.toContain(userId);
    // O resultado da ferramenta foi devolvido ao modelo no formato tool_result.
    const second = chat.calls[1].messages.at(-1);
    expect(second?.role).toBe("user");
    expect(JSON.stringify(second?.content)).toContain("R$\\u00a012.400,00".replace("\\u00a0", " "));

    const logs = await db.aiUsageLog.findMany({ where: { userId, task: "answer" } });
    expect(logs).toHaveLength(2);
    expect(answer.costCents).toBeGreaterThan(0);
  });

  it("sem ferramenta, a resposta não traz link e o texto do modelo é usado como veio", async () => {
    const chat = new FakeChat([message([{ type: "text", text: "Não tenho esse dado.", citations: null }], "end_turn")]);
    const answer = await answerQuestion({ userId, question: "Qual o preço do dólar?", today: "2026-09-17" }, { model: chat, modelId: "claude-sonnet-5" });
    expect(answer.links).toEqual([]);
    expect(answer.text).toBe("Não tenho esse dado.");
  });
});
