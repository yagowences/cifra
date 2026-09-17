import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, forUser } from "@/server/db";
import { createAccount } from "./accounts";
import { createAsset, getNetWorth, getNetWorthHistory, takeMonthlySnapshot, updateAsset } from "./networth";

const hasDb = Boolean(process.env.DATABASE_URL);
const userId = randomUUID();

describe.skipIf(!hasDb)("patrimônio", () => {
  let fundId = "";

  beforeAll(async () => {
    await db.$executeRaw`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', ${userId}::uuid, 'authenticated', 'authenticated',
        ${`nw-${userId}@cifra.test`}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
    `;
    await forUser(userId, async (tx) => {
      await createAccount(tx, userId, { name: "Corrente", type: "CHECKING", initialBalance: 1_822_045n, institution: null });
      await createAccount(tx, userId, { name: "Cartão", type: "CREDIT_CARD", initialBalance: -420_000n, closingDay: 3, dueDay: 10, institution: null });
      fundId = (await createAsset(tx, userId, { name: "Tesouro Selic", class: "FIXED_INCOME", currentValue: 12_000_000n, isLiability: false })).id;
      await createAsset(tx, userId, { name: "Ações", class: "VARIABLE_INCOME", currentValue: 8_500_000n, isLiability: false });
      await createAsset(tx, userId, { name: "Financiamento imobiliário", class: "REAL_ESTATE", currentValue: 18_000_000n, isLiability: true });
    });
  });

  afterAll(async () => {
    await db.$executeRaw`delete from auth.users where id = ${userId}::uuid`;
    await db.$disconnect();
  });

  it("posição: contas viram dinheiro, cartão vira passivo, ativos por classe, líquido = ativos − passivos", async () => {
    const nw = await forUser(userId, (tx) => getNetWorth(tx, userId));
    expect(nw.byClass).toEqual([
      { class: "FIXED_INCOME", total: 12_000_000n },
      { class: "VARIABLE_INCOME", total: 8_500_000n },
      { class: "CASH", total: 1_822_045n },
    ]);
    expect(nw.assetsTotal).toBe(22_322_045n);
    expect(nw.liabilitiesTotal).toBe(18_420_000n);
    expect(nw.liabilities.map((l) => l.name)).toEqual(["Financiamento imobiliário", "Fatura de cartão"]);
    expect(nw.net).toBe(3_902_045n);
  });

  it("snapshot é idempotente no mês e congela meses passados: o gráfico não recalcula", async () => {
    const written = await forUser(userId, (tx) => takeMonthlySnapshot(tx, userId, "2026-08-20"));
    expect(written).toBe(5);
    expect(await forUser(userId, (tx) => takeMonthlySnapshot(tx, userId, "2026-08-25"))).toBe(5);
    expect(await db.netWorthSnapshot.count({ where: { userId } })).toBe(5);

    await forUser(userId, (tx) => takeMonthlySnapshot(tx, userId, "2026-09-17"));
    // O fundo valoriza em setembro; agosto tem que continuar como estava.
    await forUser(userId, (tx) => updateAsset(tx, userId, fundId, { name: "Tesouro Selic", class: "FIXED_INCOME", currentValue: 13_000_000n, isLiability: false }));
    await forUser(userId, (tx) => takeMonthlySnapshot(tx, userId, "2026-09-17"));

    const history = await forUser(userId, (tx) => getNetWorthHistory(tx, userId, "2026-09", 3));
    expect(history.map((h) => h.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(history[0].net).toBe(0n);
    expect(history[1].net).toBe(3_902_045n);
    expect(history[2].net).toBe(4_902_045n);
  });
});
