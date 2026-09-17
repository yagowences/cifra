import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, forUser } from "@/server/db";
import { createAccount } from "./accounts";
import { attachReceipt, createFromReceipt, findDuplicateCandidates } from "./receipts";
import { createTransaction } from "./transactions";

const hasDb = Boolean(process.env.DATABASE_URL);
const userId = randomUUID();
const file = { storageKey: `${userId}/receipts/x.jpg`, mimeType: "image/jpeg", sizeBytes: 12345, ocrData: { merchant: "Pão de Açúcar", amount: 18740 } };

describe.skipIf(!hasDb)("comprovantes", () => {
  let accountId = "";
  let existingId = "";

  beforeAll(async () => {
    await db.$executeRaw`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', ${userId}::uuid, 'authenticated', 'authenticated',
        ${`rc-${userId}@cifra.test`}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
    `;
    await forUser(userId, async (tx) => {
      const account = await createAccount(tx, userId, { name: "Itaú", type: "CHECKING", initialBalance: 100_000n, institution: null });
      accountId = account.id;
      // Lançamento do extrato, sem comprovante, dois dias antes.
      const existing = await createTransaction(tx, userId, { accountId, type: "EXPENSE", amount: 18_740n, competenceDate: "2026-09-15", description: "PAO DE ACUCAR 214" });
      existingId = existing.id;
    });
  });

  afterAll(async () => {
    await db.$executeRaw`delete from auth.users where id = ${userId}::uuid`;
    await db.$disconnect();
  });

  it("acha o lançamento do extrato com o mesmo valor em data próxima", async () => {
    const found = await forUser(userId, (tx) => findDuplicateCandidates(tx, userId, { amount: 18_740n, date: "2026-09-17" }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: existingId, accountName: "Itaú", hasAttachment: false, amount: "-18740" });

    const far = await forUser(userId, (tx) => findDuplicateCandidates(tx, userId, { amount: 18_740n, date: "2026-09-25" }));
    expect(far).toHaveLength(0);
    const other = await forUser(userId, (tx) => findDuplicateCandidates(tx, userId, { amount: 18_741n, date: "2026-09-17" }));
    expect(other).toHaveLength(0);
  });

  it("anexar à existente não cria transação nova e guarda o OCR", async () => {
    await forUser(userId, (tx) => attachReceipt(tx, userId, existingId, file));
    expect(await db.transaction.count({ where: { userId } })).toBe(1);
    const attachment = await db.attachment.findFirstOrThrow({ where: { transactionId: existingId } });
    expect(attachment).toMatchObject({ kind: "RECEIPT", mimeType: "image/jpeg", ocrData: { merchant: "Pão de Açúcar", amount: 18740 } });
    const again = await forUser(userId, (tx) => findDuplicateCandidates(tx, userId, { amount: 18_740n, date: "2026-09-17" }));
    expect(again[0].hasAttachment).toBe(true);
  });

  it("criar nova: foto vira despesa OCR com anexo e o saldo cai", async () => {
    const { transaction, attachment } = await forUser(userId, (tx) =>
      createFromReceipt(tx, userId, { accountId, amount: 4_890n, date: "2026-09-17", merchant: "Padaria Vila Nova", categoryId: null, confidence: 0.86 }, { ...file, storageKey: `${userId}/receipts/y.jpg` }),
    );
    expect(transaction).toMatchObject({ amount: -4_890n, type: "EXPENSE", source: "OCR", merchant: "Padaria Vila Nova" });
    expect((await db.transaction.findUniqueOrThrow({ where: { id: transaction.id } })).aiConfidence).toBe(0.86);
    expect(attachment.transactionId).toBe(transaction.id);
    expect((await db.account.findUniqueOrThrow({ where: { id: accountId } })).currentBalance).toBe(100_000n - 18_740n - 4_890n);
  });
});
