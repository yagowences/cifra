/**
 * Integração: importar o mesmo OFX duas vezes não cria duplicata; previsão
 * casada vira a própria transação; desfazer remove tudo e devolve a previsão.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, forUser } from "@/server/db";
import { createAccount } from "@/server/services/accounts";
import { createTransaction } from "@/server/services/transactions";
import { confirmImport, ImportError, processImportBatch, readReviewRows, startImport, undoImport } from "./index";

const hasDb = Boolean(process.env.DATABASE_URL);
const userId = randomUUID();

const OFX = `OFXHEADER:100
<OFX><BANKTRANLIST>
<STMTTRN><DTPOSTED>20260903<TRNAMT>-42.90<FITID>f1<NAME>IFD*IFOOD SAO PAULO</STMTTRN>
<STMTTRN><DTPOSTED>20260905<TRNAMT>-928.40<FITID>f2<NAME>TED ALUGUEL</STMTTRN>
<STMTTRN><DTPOSTED>20260910<TRNAMT>4800.00<FITID>f3<NAME>TED RECEBIDA ACME</NAME></STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>4828.70<DTASOF>20260917</LEDGERBAL>
</OFX>`;

const bytes = new TextEncoder().encode(OFX);

describe.skipIf(!hasDb)("pipeline de importação", () => {
  let accountId = "";
  let projectedId = "";

  beforeAll(async () => {
    await db.$executeRaw`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', ${userId}::uuid, 'authenticated', 'authenticated',
        ${`imp-${userId}@cifra.test`}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
    `;
    await forUser(userId, async (tx) => {
      const account = await createAccount(tx, userId, { name: "Nubank", type: "CHECKING", initialBalance: 100_000n, institution: null });
      accountId = account.id;
      const projected = await createTransaction(tx, userId, {
        accountId,
        type: "EXPENSE",
        amount: 92_840n,
        competenceDate: "2026-09-05",
        description: "Aluguel",
        status: "PROJECTED",
      });
      projectedId = projected.id;
    });
  });

  afterAll(async () => {
    await db.$executeRaw`delete from auth.users where id = ${userId}::uuid`;
    await db.$disconnect();
  });

  it("primeira importação: 2 novas, 1 casada com a previsão, saldo confere", async () => {
    const batch = await forUser(userId, (tx) => startImport(tx, userId, { accountId, fileName: "extrato.ofx", storageKey: `${userId}/imports/x.ofx`, format: "OFX", bytes }));
    await processImportBatch(batch.id, bytes);

    const after = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(after.status).toBe("READY_FOR_REVIEW");
    const rows = readReviewRows(after);
    expect(rows.map((r) => r.status)).toEqual(["new", "matched", "new"]);
    expect(rows[1].matchId).toBe(projectedId);
    // Conta: 1.000 + (−42,90 − 928,40 + 4.800) = 4.828,70 = saldo declarado.
    expect(after.balanceDiff).toBe(0n);

    const confirmed = await forUser(userId, (tx) => confirmImport(tx, userId, batch.id, rows.map((r) => ({ key: r.key, categoryId: null }))));
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.createdCount).toBe(3);

    const txs = await db.transaction.findMany({ where: { userId }, orderBy: { competenceDate: "asc" } });
    expect(txs).toHaveLength(3);
    const rent = txs.find((t) => t.id === projectedId)!;
    expect(rent.status).toBe("CONFIRMED");
    expect(rent.externalId).toBe("f2");
    expect(rent.originalDesc).toBe("TED ALUGUEL");
    expect((await db.account.findUniqueOrThrow({ where: { id: accountId } })).currentBalance).toBe(482_870n);
  });

  it("importar o mesmo arquivo de novo não cria duplicata", async () => {
    const batch = await forUser(userId, (tx) => startImport(tx, userId, { accountId, fileName: "extrato.ofx", storageKey: `${userId}/imports/y.ofx`, format: "OFX", bytes }));
    await processImportBatch(batch.id, bytes);
    const rows = readReviewRows(await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } }));
    expect(rows.every((r) => r.status === "duplicate")).toBe(true);
    expect(rows.map((r) => r.matchReason)).toEqual(Array(3).fill("Mesmo identificador do banco"));

    await expect(forUser(userId, (tx) => confirmImport(tx, userId, batch.id, [{ key: rows[0].key, categoryId: null }]))).rejects.toBeInstanceOf(ImportError);
    expect(await db.transaction.count({ where: { userId } })).toBe(3);
  });

  it("desfazer remove o que o lote criou e devolve a previsão", async () => {
    const first = await db.importBatch.findFirstOrThrow({ where: { userId, status: "CONFIRMED" } });
    await forUser(userId, (tx) => undoImport(tx, userId, first.id));
    const txs = await db.transaction.findMany({ where: { userId } });
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ id: projectedId, status: "PROJECTED", externalId: null, importBatchId: null, originalDesc: "TED ALUGUEL" });
    expect((await db.account.findUniqueOrThrow({ where: { id: accountId } })).currentBalance).toBe(100_000n);
  });
});
