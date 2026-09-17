/**
 * Integração contra o banco de dev: parcelamento cai na competência certa
 * (com caixa no vencimento do cartão) e recorrência materializa sem duplicar.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toISODate } from "@/lib/dates";
import { db, forUser } from "@/server/db";
import { createAccount } from "./accounts";
import { createInstallments, listInstallmentSeries, updateFutureInstallments } from "./installments";
import { createRecurrence, materializeRecurrences, stopRecurrence } from "./recurrence";

const hasDb = Boolean(process.env.DATABASE_URL);
const userId = randomUUID();

describe.skipIf(!hasDb)("parcelamento e recorrência", () => {
  let cardId = "";
  let checkingId = "";

  beforeAll(async () => {
    await db.$executeRaw`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', ${userId}::uuid, 'authenticated', 'authenticated',
        ${`series-${userId}@cifra.test`}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
    `;
    const [card, checking] = await forUser(userId, async (tx) => [
      await createAccount(tx, userId, { name: "Cartão", type: "CREDIT_CARD", initialBalance: 0n, closingDay: 3, dueDay: 10, institution: null }),
      await createAccount(tx, userId, { name: "Corrente", type: "CHECKING", initialBalance: 500_000n, institution: null }),
    ]);
    cardId = card.id;
    checkingId = checking.id;
  });

  afterAll(async () => {
    await db.$executeRaw`delete from auth.users where id = ${userId}::uuid`;
    await db.$disconnect();
  });

  it("12x de R$ 1.000,00 comprado em 31/jan: competência mês a mês com clamp, caixa no vencimento", async () => {
    const parent = await forUser(userId, (tx) =>
      createInstallments(tx, userId, { accountId: cardId, type: "EXPENSE", amount: 100_000n, competenceDate: "2026-01-31", description: "Notebook" }, 12),
    );
    const series = await forUser(userId, (tx) => listInstallmentSeries(tx, userId, parent.id));

    expect(series).toHaveLength(12);
    expect(series.map((s) => s.installmentNo)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(series.map((s) => toISODate(s.competenceDate)).slice(0, 3)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    // Compra em 31/jan é depois do fechamento (dia 3) → fatura fecha 3/fev, vence 10/fev.
    expect(series.map((s) => s.cashDate && toISODate(s.cashDate)).slice(0, 2)).toEqual(["2026-02-10", "2026-03-10"]);
    expect(series.reduce((sum, s) => sum + s.amount, 0n)).toBe(-100_000n);
    expect(series[0].amount).toBe(-8_334n);
    expect(series[11].amount).toBe(-8_333n);
    expect(series.slice(1).every((s) => s.parentId === parent.id)).toBe(true);

    // Saldo do cartão: só as parcelas efetivas contam (todas, pois nascem CONFIRMED).
    const card = await db.account.findUniqueOrThrow({ where: { id: cardId } });
    expect(card.currentBalance).toBe(-100_000n);
  });

  it("editar a série propaga só para as parcelas futuras", async () => {
    const parent = await db.transaction.findFirstOrThrow({ where: { userId, description: "Notebook", installmentNo: 1 } });
    const changed = await forUser(userId, (tx) =>
      updateFutureInstallments(tx, userId, parent.id, { description: "Notebook Dell", categoryId: null }, "2026-06-15"),
    );
    // A própria (1) + as com competência depois de 15/jun (30/jun, 31/jul … 31/dez = 6..12) = 8.
    expect(changed).toBe(8);
    const series = await forUser(userId, (tx) => listInstallmentSeries(tx, userId, parent.id));
    expect(series[0].description).toBe("Notebook Dell");
    expect(series[3].description).toBe("Notebook"); // abril: já passou, não muda
    expect(series[4].description).toBe("Notebook"); // 31/mai: já passou
    expect(series[5].description).toBe("Notebook Dell"); // 30/jun: futura
    expect(series[11].description).toBe("Notebook Dell");
  });

  it("recorrência mensal materializa até o horizonte, sem duplicar, e promove previsões", async () => {
    const today = "2026-09-17";
    const rule = await forUser(userId, (tx) =>
      createRecurrence(
        tx,
        userId,
        { accountId: checkingId, type: "EXPENSE", amount: 92_840n, competenceDate: "2026-07-05", description: "Aluguel" },
        { freq: "MONTHLY", interval: 1 },
        today,
      ),
    );
    const rows = await db.transaction.findMany({ where: { userId, recurrenceId: rule.id }, orderBy: { competenceDate: "asc" } });
    expect(rows.map((r) => toISODate(r.competenceDate))).toEqual(["2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"]);
    expect(rows.map((r) => r.status)).toEqual(["CONFIRMED", "CONFIRMED", "CONFIRMED", "PROJECTED"]);

    // Saldo só com as efetivas: 500.000 − 3 × 92.840.
    expect((await db.account.findUniqueOrThrow({ where: { id: checkingId } })).currentBalance).toBe(221_480n);

    // Rodar de novo no mesmo horizonte não cria nada.
    const again = await forUser(userId, (tx) => materializeRecurrences(tx, userId, { until: "2026-10-31", today }));
    expect(again).toBe(0);

    // O tempo passa: a previsão de outubro vira efetiva e novembro é gerado.
    await forUser(userId, (tx) => materializeRecurrences(tx, userId, { until: "2026-11-30", today: "2026-10-06" }));
    const later = await db.transaction.findMany({ where: { userId, recurrenceId: rule.id }, orderBy: { competenceDate: "asc" } });
    expect(later.map((r) => r.status)).toEqual(["CONFIRMED", "CONFIRMED", "CONFIRMED", "CONFIRMED", "PROJECTED"]);

    // Encerrar remove só a previsão.
    const removed = await forUser(userId, (tx) => stopRecurrence(tx, userId, rule.id));
    expect(removed).toBe(1);
    expect(await db.transaction.count({ where: { userId, recurrenceId: rule.id } })).toBe(4);
    expect((await db.recurrenceRule.findUniqueOrThrow({ where: { id: rule.id } })).active).toBe(false);
  });
});
