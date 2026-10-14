/**
 * Camada de IA com provedor falso: cache por hash, retry com o erro no prompt,
 * revisão manual após duas falhas, log de custo e orçamento. Integração (banco).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { BudgetExceededError, createAiClient, extractJson, ManualReviewError, RateLimitedError } from "./client";
import { MODELS, PRICE_CENTS_PER_MTOK } from "./models";
import { ProviderUnavailableError } from "./providers/errors";
import type { LlmProvider, ProviderRequest, ProviderResponse } from "./provider";

const hasDb = Boolean(process.env.DATABASE_URL);
const userId = randomUUID();

class FakeProvider implements LlmProvider {
  calls: ProviderRequest[] = [];
  private failures: Error[];
  /** `failures` são lançadas, uma por chamada, antes de qualquer resposta. */
  constructor(private responses: string[], failures: Error[] = []) {
    this.failures = [...failures];
  }
  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    this.calls.push(req);
    const failure = this.failures.shift();
    if (failure) throw failure;
    const text = this.responses.shift() ?? "{}";
    return { text, model: req.model, inputTokens: 1000, outputTokens: 200, stopReason: "end_turn" };
  }
}

const validReceipt = JSON.stringify({
  amount: 18740,
  date: "2026-09-17",
  merchant: "Pão de Açúcar",
  paymentMethod: "debit",
  cardLast4: null,
  suggestedCategory: "Mercado",
  items: [],
  confidence: { amount: 0.98, date: 0.86, merchant: 0.72 },
});

describe("extractJson", () => {
  it("aceita JSON puro, com cerca de código e com prosa em volta", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Aqui está:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Segue o resultado {"a":1} conforme pedido')).toEqual({ a: 1 });
    expect(() => extractJson("sem json")).toThrow(SyntaxError);
  });
});

describe.skipIf(!hasDb)("createAiClient", () => {
  beforeAll(async () => {
    await db.$executeRaw`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', ${userId}::uuid, 'authenticated', 'authenticated',
        ${`ai-${userId}@cifra.test`}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
    `;
  });

  afterAll(async () => {
    await db.$executeRaw`delete from auth.users where id = ${userId}::uuid`;
    await db.$disconnect();
  });

  it("saída válida: valida, loga custo e entra no cache; a segunda chamada não gasta token", async () => {
    const provider = new FakeProvider([validReceipt]);
    const ai = createAiClient({ provider });
    const file = { kind: "text" as const, text: "PAO DE ACUCAR 214 TOTAL R$ 187,40 17/09/2026 CPF 123.456.789-09" };

    const first = await ai.extractReceipt(userId, file);
    expect(first.data.amount).toBe(18740);
    expect(first.cached).toBe(false);
    expect(first.costCents).toBe(costOf(1000, 200));
    // PII redigida antes de ir ao modelo.
    expect(JSON.stringify(provider.calls[0].content)).not.toContain("123.456.789-09");

    const second = await ai.extractReceipt(userId, file);
    expect(second.cached).toBe(true);
    expect(second.costCents).toBe(0);
    expect(provider.calls).toHaveLength(1);

    const logs = await db.aiUsageLog.findMany({ where: { userId, task: "extractReceipt" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ success: true, inputTokens: 1000, outputTokens: 200, model: MODELS.extract });
  });

  it("saída inválida faz um retry com o erro no prompt e aceita a segunda", async () => {
    const provider = new FakeProvider(['{"amount": "muito", "date": "ontem"}', validReceipt]);
    const ai = createAiClient({ provider });
    const result = await ai.extractReceipt(userId, { kind: "text", text: "comprovante A" });
    expect(result.data.merchant).toBe("Pão de Açúcar");
    expect(provider.calls).toHaveLength(2);
    const retryText = JSON.stringify(provider.calls[1].content);
    expect(retryText).toMatch(/não passou na validação/);
    expect(retryText).toMatch(/amount/);
    expect(result.costCents).toBe(costOf(2000, 400));
  });

  it("duas saídas inválidas caem em revisão manual, com as duas chamadas logadas como falha", async () => {
    const provider = new FakeProvider(["não sei ler isso", "```json\n{\"amount\": -1}\n```"]);
    const ai = createAiClient({ provider });
    const before = await db.aiUsageLog.count({ where: { userId, success: false } });
    await expect(ai.extractReceipt(userId, { kind: "text", text: "comprovante B" })).rejects.toBeInstanceOf(ManualReviewError);
    expect(provider.calls).toHaveLength(2);
    expect(await db.aiUsageLog.count({ where: { userId, success: false } })).toBe(before + 2);
  });

  it("acima do orçamento mensal, nem chama o provedor", async () => {
    const provider = new FakeProvider([validReceipt]);
    const original = process.env.AI_MONTHLY_BUDGET_CENTS_PER_USER;
    process.env.AI_MONTHLY_BUDGET_CENTS_PER_USER = "0";
    try {
      const ai = createAiClient({ provider });
      await expect(ai.extractReceipt(userId, { kind: "text", text: "comprovante C" })).rejects.toBeInstanceOf(BudgetExceededError);
      expect(provider.calls).toHaveLength(0);
    } finally {
      if (original === undefined) delete process.env.AI_MONTHLY_BUDGET_CENTS_PER_USER;
      else process.env.AI_MONTHLY_BUDGET_CENTS_PER_USER = original;
    }
  });

  it("sobrecarga transitória é repetida e a tentativa seguinte vale; as tentativas geram um único registro", async () => {
    const sobrecarga = () => new ProviderUnavailableError("O Gemini está sobrecarregado agora.", true);
    const provider = new FakeProvider([validReceipt], [sobrecarga(), sobrecarga()]);
    const ai = createAiClient({ provider, backoffMs: [0, 0] });
    const antes = await db.aiUsageLog.count({ where: { userId } });

    const r = await ai.extractReceipt(userId, { kind: "text", text: "comprovante E" });

    expect(r.data.amount).toBe(18740);
    expect(provider.calls).toHaveLength(3);
    // Um registro por pedido, não por tentativa: o rate limit conta essas linhas.
    expect(await db.aiUsageLog.count({ where: { userId } })).toBe(antes + 1);
  });

  it("sobrecarga que não passa esgota as tentativas e propaga o erro", async () => {
    const sobrecarga = () => new ProviderUnavailableError("O Gemini está sobrecarregado agora.", true);
    const provider = new FakeProvider([validReceipt], [sobrecarga(), sobrecarga(), sobrecarga(), sobrecarga()]);
    const ai = createAiClient({ provider, backoffMs: [0, 0] });
    await expect(ai.extractReceipt(userId, { kind: "text", text: "comprovante F" })).rejects.toBeInstanceOf(ProviderUnavailableError);
    // Primeira chamada + 2 retries; a 4ª falha programada nem chega a ser consumida.
    expect(provider.calls).toHaveLength(3);
  });

  it("chave inválida e cota esgotada não são repetidas: esperar não resolve", async () => {
    for (const [i, motivo] of ["Chave do Gemini inválida ou sem permissão.", "Limite gratuito do Gemini atingido por agora."].entries()) {
      const provider = new FakeProvider([validReceipt], [new ProviderUnavailableError(motivo)]);
      const ai = createAiClient({ provider, backoffMs: [0, 0] });
      await expect(ai.extractReceipt(userId, { kind: "text", text: `comprovante G${i}` })).rejects.toBeInstanceOf(ProviderUnavailableError);
      expect(provider.calls).toHaveLength(1);
    }
  });

  it("limite por minuto barra excesso de chamadas", async () => {
    const provider = new FakeProvider([validReceipt]);
    const ai = createAiClient({ provider, ratePerMinute: 1 });
    await expect(ai.extractReceipt(userId, { kind: "text", text: "comprovante D" })).rejects.toBeInstanceOf(RateLimitedError);
  });
});

/** Calcula pelo preço do modelo de extração ativo, seja qual for o provedor. */
const costOf = (input: number, output: number) => {
  const price = PRICE_CENTS_PER_MTOK[MODELS.extract];
  return Math.ceil(((input * price.input + output * price.output) / 1_000_000) * 100) / 100;
};
