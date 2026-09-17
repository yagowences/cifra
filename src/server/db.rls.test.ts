/**
 * Teste de integração contra o banco de dev: prova que o usuário A não lê,
 * altera nem cria dado do usuário B, e que as invariantes do banco valem.
 * Pula quando DATABASE_URL não está definida.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, forUser } from "./db";

const hasDb = Boolean(process.env.DATABASE_URL);

const userA = randomUUID();
const userB = randomUUID();

async function createAuthUser(id: string) {
  await db.$executeRaw`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', ${id}::uuid, 'authenticated', 'authenticated',
      ${`rls-${id}@cifra.test`}, '', now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    )
  `;
}

describe.skipIf(!hasDb)("RLS e invariantes do banco", () => {
  let accountA = "";
  let transactionA = "";

  beforeAll(async () => {
    await createAuthUser(userA);
    await createAuthUser(userB);
  });

  afterAll(async () => {
    await db.$executeRaw`delete from auth.users where id in (${userA}::uuid, ${userB}::uuid)`;
    await db.$disconnect();
  });

  it("signup cria perfil e 18 categorias padrão", async () => {
    const profile = await db.user.findUnique({ where: { id: userA }, include: { categories: true } });
    expect(profile).not.toBeNull();
    expect(profile?.categories).toHaveLength(18);
    expect(profile?.categories.filter((c) => c.type === "INCOME")).toHaveLength(4);
  });

  it("usuário A cria conta e transação; o saldo é recalculado pelo banco", async () => {
    const result = await forUser(userA, async (tx) => {
      const account = await tx.account.create({
        data: { userId: userA, name: "Nubank", type: "CHECKING", initialBalance: 100_000n },
      });
      const category = await tx.category.findFirstOrThrow({ where: { userId: userA, name: "Alimentação" } });
      const transaction = await tx.transaction.create({
        data: {
          userId: userA,
          accountId: account.id,
          categoryId: category.id,
          amount: -4_890n,
          type: "EXPENSE",
          competenceDate: new Date("2026-09-17"),
          description: "Padaria",
          originalDesc: "PADARIA LTDA",
          fingerprint: `fp-${randomUUID()}`,
        },
      });
      const refreshed = await tx.account.findUniqueOrThrow({ where: { id: account.id } });
      return { account, transaction, balance: refreshed.currentBalance };
    });

    accountA = result.account.id;
    transactionA = result.transaction.id;
    expect(result.balance).toBe(95_110n);
  });

  it("usuário B não enxerga nada do usuário A", async () => {
    const seen = await forUser(userB, async (tx) => ({
      accounts: await tx.account.findMany(),
      transactions: await tx.transaction.findMany(),
      categoriesOfA: await tx.category.count({ where: { userId: userA } }),
      profileA: await tx.user.findUnique({ where: { id: userA } }),
      rawTransactions: await tx.$queryRaw<{ n: bigint }[]>`select count(*)::bigint as n from public.transactions`,
    }));

    expect(seen.accounts).toEqual([]);
    expect(seen.transactions).toEqual([]);
    expect(seen.categoriesOfA).toBe(0);
    expect(seen.profileA).toBeNull();
    expect(seen.rawTransactions[0].n).toBe(0n);
  });

  it("usuário B não altera nem apaga dado do usuário A", async () => {
    const touched = await forUser(userB, async (tx) => ({
      updated: await tx.transaction.updateMany({ where: { id: transactionA }, data: { description: "invadido" } }),
      deleted: await tx.transaction.deleteMany({ where: { id: transactionA } }),
    }));
    expect(touched.updated.count).toBe(0);
    expect(touched.deleted.count).toBe(0);

    const intact = await db.transaction.findUniqueOrThrow({ where: { id: transactionA } });
    expect(intact.description).toBe("Padaria");
  });

  it("usuário B não cria dado em nome do usuário A", async () => {
    await expect(
      forUser(userB, (tx) =>
        tx.account.create({ data: { userId: userA, name: "Falsa", type: "CASH" } }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("valor com sinal errado e descrição original alterada são rejeitados", async () => {
    await expect(
      forUser(userA, (tx) =>
        tx.transaction.create({
          data: {
            userId: userA,
            accountId: accountA,
            amount: 4_890n,
            type: "EXPENSE",
            competenceDate: new Date("2026-09-17"),
            description: "Sinal errado",
            fingerprint: `fp-${randomUUID()}`,
          },
        }),
      ),
    ).rejects.toThrow(/transactions_amount_sign_check/);

    await expect(
      forUser(userA, (tx) =>
        tx.transaction.update({ where: { id: transactionA }, data: { originalDesc: "OUTRA" } }),
      ),
    ).rejects.toThrow(/original_desc é imutável/);
  });

  it("transferência sai de uma conta e entra na outra, sem virar receita ou despesa", async () => {
    const balances = await forUser(userA, async (tx) => {
      const savings = await tx.account.create({
        data: { userId: userA, name: "Poupança", type: "SAVINGS", initialBalance: 0n },
      });
      await tx.transaction.create({
        data: {
          userId: userA,
          accountId: accountA,
          transferAccountId: savings.id,
          amount: -50_000n,
          type: "TRANSFER",
          competenceDate: new Date("2026-09-17"),
          description: "Guardar",
          fingerprint: `fp-${randomUUID()}`,
        },
      });
      const [from, to] = await Promise.all([
        tx.account.findUniqueOrThrow({ where: { id: accountA } }),
        tx.account.findUniqueOrThrow({ where: { id: savings.id } }),
      ]);
      return { from: from.currentBalance, to: to.currentBalance };
    });

    expect(balances.from).toBe(45_110n);
    expect(balances.to).toBe(50_000n);
  });
});
