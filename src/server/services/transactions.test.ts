/**
 * Integração contra o banco de dev: CRUD de transações com saldo recalculado,
 * duplicata barrada pelo fingerprint, e excluir → desfazer.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, forUser } from "@/server/db";
import { createAccount, deleteAccount, listAccounts, setAccountArchived } from "./accounts";
import {
  createTransaction,
  deleteTransaction,
  DuplicateTransactionError,
  duplicateTransaction,
  restoreTransaction,
  updateTransaction,
} from "./transactions";

const hasDb = Boolean(process.env.DATABASE_URL);
const userId = randomUUID();

describe.skipIf(!hasDb)("serviços de contas e transações", () => {
  let accountId = "";
  let categoryId = "";
  let savingsId = "";

  beforeAll(async () => {
    await db.$executeRaw`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', ${userId}::uuid, 'authenticated', 'authenticated',
        ${`svc-${userId}@cifra.test`}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
    `;
    const category = await db.category.findFirstOrThrow({ where: { userId, name: "Alimentação" } });
    categoryId = category.id;
  });

  afterAll(async () => {
    await db.$executeRaw`delete from auth.users where id = ${userId}::uuid`;
    await db.$disconnect();
  });

  it("cria contas e lista só as ativas por padrão", async () => {
    const [a, b] = await forUser(userId, async (tx) => [
      await createAccount(tx, userId, { name: "Nubank", type: "CHECKING", initialBalance: 100_000n, institution: null }),
      await createAccount(tx, userId, { name: "Cofre", type: "SAVINGS", initialBalance: 0n, institution: null }),
    ]);
    accountId = a.id;
    savingsId = b.id;
    await forUser(userId, (tx) => setAccountArchived(tx, userId, b.id, true));
    const active = await forUser(userId, (tx) => listAccounts(tx, userId));
    expect(active.map((x) => x.name)).toEqual(["Nubank"]);
    await forUser(userId, (tx) => setAccountArchived(tx, userId, b.id, false));
  });

  it("criar despesa recalcula o saldo e grava auditoria e memória de comerciante", async () => {
    const created = await forUser(userId, (tx) =>
      createTransaction(tx, userId, {
        accountId,
        type: "EXPENSE",
        amount: 4_890n,
        competenceDate: "2026-09-17",
        description: "iFood",
        categoryId,
      }),
    );
    expect(created.amount).toBe(-4_890n);

    const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.currentBalance).toBe(95_110n);

    const audit = await db.auditLog.findFirst({ where: { userId, entityId: created.id, action: "CREATE" } });
    expect(audit?.source).toBe("MANUAL");

    const memory = await db.merchantMemory.findUnique({ where: { userId_normalizedDesc: { userId, normalizedDesc: "ifood" } } });
    expect(memory?.categoryId).toBe(categoryId);
  });

  it("o mesmo lançamento de novo é barrado pelo fingerprint", async () => {
    await expect(
      forUser(userId, (tx) =>
        createTransaction(tx, userId, { accountId, type: "EXPENSE", amount: 4_890n, competenceDate: "2026-09-17", description: " IFOOD " }),
      ),
    ).rejects.toBeInstanceOf(DuplicateTransactionError);
  });

  it("editar valor recalcula; duplicar cria cópia para hoje", async () => {
    const original = await db.transaction.findFirstOrThrow({ where: { userId, description: "iFood" } });
    await forUser(userId, (tx) =>
      updateTransaction(tx, userId, original.id, {
        accountId,
        type: "EXPENSE",
        amount: 5_000n,
        competenceDate: "2026-09-17",
        description: "iFood",
        categoryId,
      }),
    );
    expect((await db.account.findUniqueOrThrow({ where: { id: accountId } })).currentBalance).toBe(95_000n);

    const copy = await forUser(userId, (tx) => duplicateTransaction(tx, userId, original.id, "2026-09-18"));
    expect(copy.amount).toBe(-5_000n);
    expect(copy.competenceDate.toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect((await db.account.findUniqueOrThrow({ where: { id: accountId } })).currentBalance).toBe(90_000n);
  });

  it("excluir devolve o saldo e desfazer restaura com o mesmo id", async () => {
    const copy = await db.transaction.findFirstOrThrow({ where: { userId, competenceDate: new Date("2026-09-18") } });
    const snapshot = await forUser(userId, (tx) => deleteTransaction(tx, userId, copy.id));
    expect((await db.account.findUniqueOrThrow({ where: { id: accountId } })).currentBalance).toBe(95_000n);

    const restored = await forUser(userId, (tx) => restoreTransaction(tx, userId, snapshot));
    expect(restored.id).toBe(copy.id);
    expect((await db.account.findUniqueOrThrow({ where: { id: accountId } })).currentBalance).toBe(90_000n);
  });

  it("transferência move saldo entre contas e conta com lançamentos não pode ser excluída", async () => {
    await forUser(userId, (tx) =>
      createTransaction(tx, userId, {
        accountId,
        transferAccountId: savingsId,
        type: "TRANSFER",
        amount: 10_000n,
        competenceDate: "2026-09-17",
        description: "Guardar",
      }),
    );
    const [from, to] = await Promise.all([
      db.account.findUniqueOrThrow({ where: { id: accountId } }),
      db.account.findUniqueOrThrow({ where: { id: savingsId } }),
    ]);
    expect(from.currentBalance).toBe(80_000n);
    expect(to.currentBalance).toBe(10_000n);

    await expect(forUser(userId, (tx) => deleteAccount(tx, userId, savingsId))).rejects.toThrow(/lançamentos/);
  });
});
