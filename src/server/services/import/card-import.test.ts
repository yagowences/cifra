/**
 * Integração: pagamento de fatura vira transferência (uma só, mesmo importando cartão e corrente),
 * resgate de pontos abate despesa e nada disso entra como receita.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, forUser } from "@/server/db";
import { getSummary, periodForMonth } from "@/server/queries/summary";
import { createAccount } from "@/server/services/accounts";
import { confirmImport, processImportBatch, readReviewRows, startImport } from "./index";
import type { ReviewRow } from "./types";

const hasDb = Boolean(process.env.DATABASE_URL);
const userId = randomUUID();

const ofx = (lines: { fitid: string; dia: string; valor: string; nome: string }[]) =>
  new TextEncoder().encode(`OFXHEADER:100
<OFX><BANKTRANLIST>
${lines.map((l) => `<STMTTRN><DTPOSTED>${l.dia}<TRNAMT>${l.valor}<FITID>${l.fitid}<NAME>${l.nome}</STMTTRN>`).join("\n")}
</BANKTRANLIST>
<LEDGERBAL><BALAMT>0.00<DTASOF>20260930</LEDGERBAL>
</OFX>`);

describe.skipIf(!hasDb)("cartão de crédito: pagamento, pontos e anti-duplicação", () => {
  let cardId = "";
  let bankId = "";

  beforeAll(async () => {
    await db.$executeRaw`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', ${userId}::uuid, 'authenticated', 'authenticated',
        ${`card-${userId}@cifra.test`}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
    `;
    await forUser(userId, async (tx) => {
      bankId = (await createAccount(tx, userId, { name: "Inter Corrente", type: "CHECKING", initialBalance: 1_000_000n, institution: "Inter" })).id;
      cardId = (await createAccount(tx, userId, { name: "Inter Cartão", type: "CREDIT_CARD", initialBalance: 0n, institution: "Inter", closingDay: 5, dueDay: 12 })).id;
    });
  });

  afterAll(async () => {
    await db.$executeRaw`delete from auth.users where id = ${userId}::uuid`;
    await db.$disconnect();
  });

  const importar = async (accountId: string, bytes: Uint8Array, name: string, pick: (r: ReviewRow) => { categoryId: string | null; counterAccountId?: string | null }) => {
    const batch = await forUser(userId, (tx) => startImport(tx, userId, { accountId, fileName: name, storageKey: `${userId}/imports/${name}`, format: "OFX", bytes }));
    await processImportBatch(batch.id, bytes, null, { ai: null });
    const rows = readReviewRows(await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } }));
    const confirm = () =>
      forUser(userId, (tx) =>
        confirmImport(
          tx,
          userId,
          batch.id,
          rows.filter((r) => r.status !== "duplicate").map((r) => ({ key: r.key, ...pick(r) })),
        ),
      );
    return { rows, confirm };
  };

  it("fatura: pagamento vira transferência, pontos abatem despesa, receita fica zerada", async () => {
    const category = await forUser(userId, (tx) => tx.category.findFirstOrThrow({ where: { userId, type: "EXPENSE" } }));
    const fatura = ofx([
      { fitid: "c1", dia: "20260915", valor: "-100.00", nome: "MERCADO ZE" },
      { fitid: "c2", dia: "20260916", valor: "-50.00", nome: "FARMACIA SAO JOAO" },
      { fitid: "c3", dia: "20260920", valor: "30.00", nome: "RESGATE PONTOS" },
      { fitid: "c4", dia: "20260921", valor: "1000.00", nome: "PAGAMENTO ON LINE" },
    ]);
    const { rows, confirm } = await importar(cardId, fatura, "fatura.ofx", (r) => ({ categoryId: r.kind === "refund" ? category.id : null }));

    const pagamento = rows.find((r) => r.description === "PAGAMENTO ON LINE")!;
    const pontos = rows.find((r) => r.description === "RESGATE PONTOS")!;
    expect(pagamento).toMatchObject({ kind: "transfer", counterAccountId: bankId });
    expect(pontos.kind).toBe("refund");
    expect(rows.filter((r) => r.kind)).toHaveLength(2);

    await confirm();

    const transfers = await db.transaction.findMany({ where: { userId, type: "TRANSFER" } });
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ accountId: bankId, transferAccountId: cardId, amount: -100_000n });

    const refund = await db.transaction.findFirstOrThrow({ where: { userId, isRefund: true } });
    expect(refund).toMatchObject({ type: "INCOME", amount: 3_000n, accountId: cardId });

    // Receita do mês: nada. Despesa: 100 + 50 − 30 de pontos = 120.
    const summary = await forUser(userId, (tx) => getSummary(tx, userId, periodForMonth("2026-09")));
    expect(summary.income).toBe(0n);
    expect(summary.expense).toBe(12_000n);

    // Corrente pagou 1.000; cartão: −150 + 30 + 1.000 = +880 (crédito a favor).
    expect((await db.account.findUniqueOrThrow({ where: { id: bankId } })).currentBalance).toBe(900_000n);
    expect((await db.account.findUniqueOrThrow({ where: { id: cardId } })).currentBalance).toBe(88_000n);
  });

  it("importar a corrente depois: o mesmo pagamento já registrado vem como duplicata", async () => {
    const extrato = ofx([
      { fitid: "b1", dia: "20260921", valor: "-1000.00", nome: "PAGAMENTO FATURA CARTAO INTER" },
      { fitid: "b2", dia: "20260922", valor: "-40.00", nome: "PADARIA CENTRAL" },
    ]);
    const { rows, confirm } = await importar(bankId, extrato, "corrente.ofx", () => ({ categoryId: null }));
    const pagamento = rows.find((r) => r.description.startsWith("PAGAMENTO FATURA"))!;
    expect(pagamento).toMatchObject({ kind: "transfer", status: "duplicate" });
    expect(rows.find((r) => r.description === "PADARIA CENTRAL")!.kind ?? null).toBeNull();

    await confirm();
    expect(await db.transaction.count({ where: { userId, type: "TRANSFER" } })).toBe(1);
    expect((await db.account.findUniqueOrThrow({ where: { id: bankId } })).currentBalance).toBe(896_000n);
  });

  it("pagamento sem a outra conta não é aprovado", async () => {
    const { rows } = await importar(
      cardId,
      ofx([{ fitid: "d1", dia: "20261021", valor: "200.00", nome: "PAGAMENTO RECEBIDO" }]),
      "sem-conta.ofx",
      () => ({ categoryId: null, counterAccountId: null }),
    );
    const batchId = (await db.importBatch.findFirstOrThrow({ where: { userId, fileName: "sem-conta.ofx" } })).id;
    // Remove a sugestão automática para simular instituição sem correspondente.
    const semSugestao = rows.map((r) => ({ ...r, counterAccountId: null }));
    await db.importBatch.update({ where: { id: batchId }, data: { rows: semSugestao } });
    await expect(
      forUser(userId, (tx) => confirmImport(tx, userId, batchId, rows.map((r) => ({ key: r.key, categoryId: null, counterAccountId: null })))),
    ).rejects.toThrow(/outra conta/);
  });
});
