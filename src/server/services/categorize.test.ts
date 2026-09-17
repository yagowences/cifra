/**
 * Cascata de categorização: cada nível resolve o que lhe cabe, na ordem, e a
 * acurácia dos níveis determinísticos é medida num conjunto de teste.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiClient, Extracted } from "@/ai/client";
import type { Categorized } from "@/ai/schemas/categorize";
import { db, forUser } from "@/server/db";
import { createAccount } from "./accounts";
import { categorizeCascade, createRule, ruleMatches, ruleSuggestionFor } from "./categorize";
import { createTransaction, updateTransaction } from "./transactions";

const hasDb = Boolean(process.env.DATABASE_URL);
const userId = randomUUID();

/** Histórico já categorizado (o que o usuário fez até aqui). */
const HISTORY: Array<[string, string]> = [
  ["IFD*IFOOD SAO PAULO", "Alimentação"],
  ["RAPPI*RAPPI BRASIL", "Alimentação"],
  ["PADARIA VILA NOVA", "Alimentação"],
  ["SUPERMERCADO PAO DE ACUCAR 214", "Alimentação"],
  ["UBER *TRIP", "Transporte"],
  ["99APP *99 TECNOLOGIA", "Transporte"],
  ["POSTO BR 1042 GOIANIA", "Transporte"],
  ["NETFLIX.COM", "Assinaturas"],
  ["SPOTIFY", "Assinaturas"],
  ["AMAZON PRIME BR", "Assinaturas"],
  ["DROGARIA SAO PAULO", "Saúde"],
  ["UNIMED GOIANIA", "Saúde"],
  ["ALUGUEL APTO 302", "Moradia"],
  ["ENEL DISTRIBUICAO GO", "Moradia"],
  ["SANEAGO", "Moradia"],
  ["CINEMARK", "Lazer"],
  ["STEAM PURCHASE", "Lazer"],
  ["PETZ", "Pets"],
  ["LATAM AIRLINES", "Viagem"],
  ["ESCOLA MUNDO FELIZ", "Educação"],
];

/** Conjunto de teste: variações que um extrato traz, com a categoria esperada. */
const TEST_SET: Array<[string, string]> = [
  ["IFD*IFOOD SAO PAULO BR", "Alimentação"],
  ["RAPPI*RAPPI BRASIL INTERM", "Alimentação"],
  ["PADARIA VILA NOVA LTDA", "Alimentação"],
  ["SUPERMERCADO PAO DE ACUCAR 117", "Alimentação"],
  ["UBER *TRIP HELP.UBER.COM", "Transporte"],
  ["99APP *99 TECNOLOGIA LTDA", "Transporte"],
  ["POSTO BR 2201 GOIANIA", "Transporte"],
  ["NETFLIX.COM ASSINATURA", "Assinaturas"],
  ["SPOTIFY AB", "Assinaturas"],
  ["AMAZON PRIME BR MENSAL", "Assinaturas"],
  ["DROGARIA SAO PAULO 44", "Saúde"],
  ["UNIMED GOIANIA COOP", "Saúde"],
  ["ENEL DISTRIBUICAO GOIAS", "Moradia"],
  ["SANEAGO AGUA", "Moradia"],
  ["CINEMARK FLAMBOYANT", "Lazer"],
  ["STEAM PURCHASE 123", "Lazer"],
  ["PETZ LOJA 12", "Pets"],
  ["LATAM AIRLINES BR", "Viagem"],
  ["ESCOLA MUNDO FELIZ MENSALIDADE", "Educação"],
  ["ifood", "Alimentação"],
];

class FakeAi implements AiClient {
  calls = 0;
  constructor(private categoryId: string) {}
  async categorize(_userId: string, txs: { index: number }[]): Promise<Extracted<Categorized>> {
    this.calls++;
    return { data: { results: txs.map((t) => ({ index: t.index, categoryId: this.categoryId, confidence: 0.7 })) }, model: "fake", costCents: 0.5, cached: false };
  }
  extractStatement(): never {
    throw new Error("não usado");
  }
  extractReceipt(): never {
    throw new Error("não usado");
  }
}

describe.skipIf(!hasDb)("categorização em cascata", () => {
  let accountId = "";
  const categoryByName = new Map<string, string>();
  const nameById = new Map<string, string>();

  beforeAll(async () => {
    await db.$executeRaw`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', ${userId}::uuid, 'authenticated', 'authenticated',
        ${`cat-${userId}@cifra.test`}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
    `;
    const categories = await db.category.findMany({ where: { userId } });
    for (const c of categories) {
      categoryByName.set(c.name, c.id);
      nameById.set(c.id, c.name);
    }
    await forUser(userId, async (tx) => {
      accountId = (await createAccount(tx, userId, { name: "Nubank", type: "CHECKING", initialBalance: 0n, institution: null })).id;
      let day = 1;
      for (const [description, category] of HISTORY) {
        await createTransaction(tx, userId, { accountId, type: "EXPENSE", amount: 1_000n + BigInt(day), competenceDate: `2026-08-${String(day++).padStart(2, "0")}`, description, categoryId: categoryByName.get(category)! });
      }
    });
    // Zera a memória criada pelos lançamentos do histórico: o teste de kNN precisa do nível 3 sozinho.
    await db.merchantMemory.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await db.$executeRaw`delete from auth.users where id = ${userId}::uuid`;
    await db.$disconnect();
  });

  it("nível 3 (vizinhos no histórico) acerta ao menos 85% do conjunto de teste", async () => {
    const items = TEST_SET.map(([description], index) => ({ index, description, amount: "-1000" }));
    const results = await forUser(userId, (tx) => categorizeCascade(tx, userId, items, { ai: null }));
    const hits = results.filter((r, i) => r.categoryId && nameById.get(r.categoryId) === TEST_SET[i][1]).length;
    const accuracy = hits / TEST_SET.length;
    const misses = results.filter((r, i) => !(r.categoryId && nameById.get(r.categoryId) === TEST_SET[i][1])).map((r, i) => TEST_SET[results.indexOf(r)]?.[0] ?? String(i));
    console.info(`acurácia kNN: ${(accuracy * 100).toFixed(0)}% (${hits}/${TEST_SET.length}); erros: ${misses.join(" | ") || "nenhum"}`);
    expect(accuracy).toBeGreaterThanOrEqual(0.85);
    expect(results.every((r) => r.categoryId === null || r.source === "knn")).toBe(true);
  });

  it("regra explícita vence a memória, e a memória vence o kNN", async () => {
    const lazer = categoryByName.get("Lazer")!;
    const compras = categoryByName.get("Compras")!;
    await forUser(userId, async (tx) => {
      await tx.merchantMemory.create({ data: { userId, normalizedDesc: "ifd ifood sao paulo", categoryId: lazer, hitCount: 1 } });
      await createRule(tx, userId, { name: "Uber é Compras (teste)", conditions: { descriptionContains: ["uber"] }, categoryId: compras });
    });
    const results = await forUser(userId, (tx) =>
      categorizeCascade(tx, userId, [
        { index: 0, description: "UBER *TRIP", amount: "-2500" },
        { index: 1, description: "IFD*IFOOD SAO PAULO", amount: "-4290" },
        { index: 2, description: "POSTO BR 1042", amount: "-18000" },
        { index: 3, description: "XPTO DESCONHECIDO", amount: "-100" },
      ], { ai: null }),
    );
    expect(results[0]).toMatchObject({ categoryId: compras, source: "rule", confidence: 1 });
    expect(results[1]).toMatchObject({ categoryId: lazer, source: "memory" });
    expect(results[2]).toMatchObject({ categoryId: categoryByName.get("Transporte"), source: "knn" });
    expect(results[3]).toMatchObject({ categoryId: null, source: null });
    expect((await db.automationRule.findFirstOrThrow({ where: { userId } })).hitCount).toBe(1);
  });

  it("o LLM só recebe o que sobrou, em lote", async () => {
    const ai = new FakeAi(categoryByName.get("Compras")!);
    const results = await forUser(userId, (tx) =>
      categorizeCascade(tx, userId, [
        { index: 0, description: "UBER *TRIP", amount: "-2500" },
        { index: 1, description: "LOJA MISTERIOSA 1", amount: "-100" },
        { index: 2, description: "LOJA MISTERIOSA 2", amount: "-200" },
      ], { ai }),
    );
    expect(ai.calls).toBe(1);
    expect(results.map((r) => r.source)).toEqual(["rule", "llm", "llm"]);
  });

  it("corrigir a categoria três vezes alimenta a memória e propõe uma regra", async () => {
    const saude = categoryByName.get("Saúde")!;
    const lazer = categoryByName.get("Lazer")!;
    await forUser(userId, async (tx) => {
      for (let i = 0; i < 3; i++) {
        const created = await createTransaction(tx, userId, { accountId, type: "EXPENSE", amount: 5_000n + BigInt(i), competenceDate: `2026-09-1${i}`, description: "ACADEMIA SMART FIT", categoryId: lazer });
        await updateTransaction(tx, userId, created.id, { accountId, type: "EXPENSE", amount: 5_000n + BigInt(i), competenceDate: `2026-09-1${i}`, description: "ACADEMIA SMART FIT", categoryId: saude });
      }
    });
    const memory = await db.merchantMemory.findUniqueOrThrow({ where: { userId_normalizedDesc: { userId, normalizedDesc: "academia smart fit" } } });
    expect(memory.categoryId).toBe(saude);
    expect(memory.hitCount).toBeGreaterThanOrEqual(3);
    const suggestion = await forUser(userId, (tx) => ruleSuggestionFor(tx, userId, "ACADEMIA SMART FIT"));
    expect(suggestion).toMatchObject({ categoryId: saude, categoryName: "Saúde" });
    await forUser(userId, (tx) => createRule(tx, userId, { name: "Smart Fit", conditions: { descriptionContains: ["smart fit"] }, categoryId: saude }));
    expect(await forUser(userId, (tx) => ruleSuggestionFor(tx, userId, "ACADEMIA SMART FIT"))).toBeNull();
  });
});

describe("ruleMatches", () => {
  it("compara sem acento e caixa, com faixa de valor e tipo", () => {
    expect(ruleMatches({ descriptionContains: ["padaria"] }, { description: "PADARIA VILA NOVA", amount: -1n })).toBe(true);
    expect(ruleMatches({ descriptionContains: ["Açaí"] }, { description: "acai do joao", amount: -1n })).toBe(true);
    expect(ruleMatches({ descriptionContains: ["uber"], amountMin: "10000" }, { description: "UBER", amount: -5000n })).toBe(false);
    expect(ruleMatches({ descriptionContains: ["pix"], type: "INCOME" }, { description: "PIX RECEBIDO", amount: 100n })).toBe(true);
    expect(ruleMatches({ descriptionContains: ["pix"], type: "INCOME" }, { description: "PIX ENVIADO", amount: -100n })).toBe(false);
  });
});
