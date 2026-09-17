/**
 * Integração: os agregados do dashboard batem com a soma manual das transações
 * de teste, e transferência/previsão/ignorado ficam fora.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, forUser } from "@/server/db";
import { createAccount } from "@/server/services/accounts";
import { createTransaction } from "@/server/services/transactions";
import { comparePeriods, getAccountsBalance, getByCategory, getMonthlyFlow, getSummary, periodForMonth } from "./summary";

const hasDb = Boolean(process.env.DATABASE_URL);
const userId = randomUUID();

describe.skipIf(!hasDb)("queries agregadas", () => {
  beforeAll(async () => {
    await db.$executeRaw`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', ${userId}::uuid, 'authenticated', 'authenticated',
        ${`sum-${userId}@cifra.test`}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
    `;
    await forUser(userId, async (tx) => {
      const nubank = await createAccount(tx, userId, { name: "Nubank", type: "CHECKING", initialBalance: 100_000n, institution: null });
      const cofre = await createAccount(tx, userId, { name: "Cofre", type: "SAVINGS", initialBalance: 0n, institution: null });
      const cat = async (name: string) => (await tx.category.findFirstOrThrow({ where: { userId, name } })).id;
      const [alimentacao, moradia, transporte, salario] = await Promise.all([cat("Alimentação"), cat("Moradia"), cat("Transporte"), cat("Salário")]);
      const add = (over: Partial<Parameters<typeof createTransaction>[2]> & { amount: bigint; description: string }) =>
        createTransaction(tx, userId, { accountId: nubank.id, type: "EXPENSE", competenceDate: "2026-09-10", ...over });

      // Setembro: entradas 12.400,00; saídas 1.840 + 1.200 + 680 + 55,90 (sem categoria) = 3.775,90.
      await add({ type: "INCOME", amount: 1_240_000n, description: "Salário", categoryId: salario });
      await add({ amount: 184_000n, description: "Mercado", categoryId: alimentacao });
      await add({ amount: 120_000n, description: "Aluguel", categoryId: moradia });
      await add({ amount: 68_000n, description: "Uber", categoryId: transporte });
      await add({ amount: 5_590n, description: "Netflix" });
      // Fora das somas: transferência, ignorado e previsão.
      await add({ type: "TRANSFER", amount: 50_000n, description: "Guardar", transferAccountId: cofre.id });
      await add({ amount: 99_900n, description: "Ignorado", status: "IGNORED" });
      await add({ amount: 77_700n, description: "Previsto", status: "PROJECTED", competenceDate: "2026-09-28" });
      // Agosto: alimentação 1.437,00.
      await add({ amount: 143_700n, description: "Mercado ago", categoryId: alimentacao, competenceDate: "2026-08-12" });
    });
  });

  afterAll(async () => {
    await db.$executeRaw`delete from auth.users where id = ${userId}::uuid`;
    await db.$disconnect();
  });

  it("getSummary bate com a soma manual e exclui transferência, ignorado e previsão", async () => {
    const s = await forUser(userId, (tx) => getSummary(tx, userId, periodForMonth("2026-09")));
    expect(s.income).toBe(1_240_000n);
    expect(s.expense).toBe(377_590n);
    expect(s.result).toBe(862_410n);
    expect(s.savingsRate).toBe(69.5);
  });

  it("getByCategory ordena, calcula percentual e agrupa em Outros", async () => {
    const all = await forUser(userId, (tx) => getByCategory(tx, userId, periodForMonth("2026-09"), "EXPENSE"));
    expect(all.map((c) => [c.name, c.total])).toEqual([
      ["Alimentação", 184_000n],
      ["Moradia", 120_000n],
      ["Transporte", 68_000n],
      ["Sem categoria", 5_590n],
    ]);
    expect(all[0].percent).toBe(48.7);

    const limited = await forUser(userId, (tx) => getByCategory(tx, userId, periodForMonth("2026-09"), "EXPENSE", 2));
    expect(limited.map((c) => c.name)).toEqual(["Alimentação", "Moradia", "Outros"]);
    expect(limited[2].total).toBe(73_590n);
    expect(limited[2].isOthers).toBe(true);
  });

  it("comparePeriods mede a variação de alimentação entre agosto e setembro", async () => {
    const deltas = await forUser(userId, (tx) => comparePeriods(tx, userId, periodForMonth("2026-08"), periodForMonth("2026-09")));
    const food = deltas.find((d) => d.name === "Alimentação");
    expect(food).toMatchObject({ before: 143_700n, after: 184_000n, delta: 40_300n, deltaPercent: 28 });
    expect(deltas.find((d) => d.name === "Moradia")?.deltaPercent).toBeNull();
  });

  it("getMonthlyFlow devolve um ponto por mês, com zeros onde não há dados", async () => {
    const flow = await forUser(userId, (tx) => getMonthlyFlow(tx, userId, "2026-09", 3));
    expect(flow.map((f) => f.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(flow[0]).toMatchObject({ income: 0n, expense: 0n, result: 0n });
    expect(flow[1]).toMatchObject({ income: 0n, expense: 143_700n, result: -143_700n });
    expect(flow[2]).toMatchObject({ income: 1_240_000n, expense: 377_590n, result: 862_410n });
  });

  it("saldo das contas soma os saldos derivados", async () => {
    const balance = await forUser(userId, (tx) => getAccountsBalance(tx, userId));
    // Nubank: 1.000 + 12.400 − 3.775,90 − 1.437 − 50 (transferência) = 8.137,10; Cofre: +50 → 8.187,10
    expect(balance.total).toBe(818_710n);
    expect(balance.count).toBe(2);
  });
});
