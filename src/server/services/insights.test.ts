import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, forUser } from "@/server/db";
import { createAccount } from "./accounts";
import { generateInsights, listInsights } from "./insights";
import { createTransaction } from "./transactions";

const hasDb = Boolean(process.env.DATABASE_URL);
const userId = randomUUID();

describe.skipIf(!hasDb)("insights", () => {
  beforeAll(async () => {
    await db.$executeRaw`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', ${userId}::uuid, 'authenticated', 'authenticated',
        ${`ins-${userId}@cifra.test`}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
    `;
    await forUser(userId, async (tx) => {
      const accountId = (await createAccount(tx, userId, { name: "Nubank", type: "CHECKING", initialBalance: 0n, institution: null })).id;
      const food = (await tx.category.findFirstOrThrow({ where: { userId, name: "Alimentação" } })).id;
      const add = (date: string, amount: bigint, description: string, categoryId?: string) =>
        createTransaction(tx, userId, { accountId, type: "EXPENSE", amount, competenceDate: date, description, categoryId: categoryId ?? null });
      // Alimentação: 6 meses em torno de 1.437 (variando mais que ±5%, como mercado varia) e setembro com 1.840.
      for (const [i, v] of [130000n, 152000n, 143000n, 138000n, 158000n, 141000n].entries()) await add(`2026-0${3 + i}-10`, v, "Mercado", food);
      await add("2026-09-10", 184000n, "Mercado", food);
      // Netflix mensal, valor estável.
      for (const mth of ["06", "07", "08", "09"]) await add(`2026-${mth}-06`, 5590n, "NETFLIX.COM");
    });
  });

  afterAll(async () => {
    await db.$executeRaw`delete from auth.users where id = ${userId}::uuid`;
    await db.$disconnect();
  });

  it("gera aumento por categoria e assinaturas, com números vindos das queries", async () => {
    const created = await forUser(userId, (tx) => generateInsights(tx, userId, "2026-09-17"));
    expect(created).toBeGreaterThanOrEqual(2);
    const list = await forUser(userId, (tx) => listInsights(tx, userId, "2026-09"));
    const spike = list.find((i) => i.type.startsWith("category_spike:"))!;
    expect(spike.title).toBe("Alimentação subiu 28%");
    expect(spike.body).toContain("R$ 1.840,00 em setembro contra média de R$ 1.436,67");
    expect(spike.href).toMatch(/tipo=EXPENSE&categoria=/);
    const subs = list.find((i) => i.type === "subscriptions")!;
    expect(subs.title).toBe("1 assinatura ativa soma R$ 55,90/mês");
  });

  it("rodar de novo atualiza em vez de duplicar", async () => {
    await forUser(userId, (tx) => generateInsights(tx, userId, "2026-09-18"));
    const count = await db.insight.count({ where: { userId, type: "subscriptions" } });
    expect(count).toBe(1);
  });
});
