import "server-only";
import type { AssetClass } from "@prisma/client";
import { addMonths, fromISODate, monthPeriod, todayISO, type ISODate } from "@/lib/dates";
import type { UserDb } from "@/server/db";
import { NotFoundError } from "./transactions";

export type AssetInput = {
  name: string;
  class: AssetClass;
  /** Valor atual em centavos, sempre positivo; passivo é marcado por isLiability. */
  currentValue: bigint;
  isLiability: boolean;
};

export function listAssets(tx: UserDb, userId: string) {
  return tx.asset.findMany({ where: { userId, archived: false }, orderBy: [{ isLiability: "asc" }, { currentValue: "desc" }] });
}

export function createAsset(tx: UserDb, userId: string, input: AssetInput) {
  return tx.asset.create({ data: { userId, ...input, currentValue: input.currentValue < 0n ? -input.currentValue : input.currentValue } });
}

export async function updateAsset(tx: UserDb, userId: string, id: string, input: AssetInput) {
  const found = await tx.asset.findFirst({ where: { id, userId } });
  if (!found) throw new NotFoundError("Ativo");
  return tx.asset.update({ where: { id }, data: { ...input, currentValue: input.currentValue < 0n ? -input.currentValue : input.currentValue } });
}

export async function archiveAsset(tx: UserDb, userId: string, id: string) {
  const found = await tx.asset.findFirst({ where: { id, userId } });
  if (!found) throw new NotFoundError("Ativo");
  return tx.asset.update({ where: { id }, data: { archived: true } });
}

export type NetWorthPosition = {
  /** Por classe, só ativos (contas entram como CASH). */
  byClass: { class: AssetClass; total: bigint }[];
  liabilities: { id: string; name: string; class: AssetClass; value: bigint }[];
  assetsTotal: bigint;
  liabilitiesTotal: bigint;
  net: bigint;
};

/** Posição atual: contas ativas (saldo em dinheiro) + ativos − passivos. */
export async function getNetWorth(tx: UserDb, userId: string): Promise<NetWorthPosition> {
  const [accounts, assets] = await Promise.all([
    tx.account.findMany({ where: { userId, archived: false }, select: { currentBalance: true, type: true } }),
    listAssets(tx, userId),
  ]);
  const byClass = new Map<AssetClass, bigint>();
  const add = (cls: AssetClass, v: bigint) => byClass.set(cls, (byClass.get(cls) ?? 0n) + v);

  // Cartão com fatura em aberto é passivo; conta com saldo positivo é dinheiro.
  const cardDebt = accounts.filter((a) => a.currentBalance < 0n).reduce((s, a) => s - a.currentBalance, 0n);
  const cash = accounts.filter((a) => a.currentBalance > 0n).reduce((s, a) => s + a.currentBalance, 0n);
  if (cash > 0n) add("CASH", cash);

  const liabilities = assets.filter((a) => a.isLiability).map((a) => ({ id: a.id, name: a.name, class: a.class, value: a.currentValue }));
  for (const a of assets.filter((a) => !a.isLiability)) add(a.class, a.currentValue);

  const assetsTotal = Array.from(byClass.values()).reduce((s, v) => s + v, 0n);
  const liabilitiesTotal = liabilities.reduce((s, l) => s + l.value, 0n) + cardDebt;
  if (cardDebt > 0n) liabilities.push({ id: "cards", name: "Fatura de cartão", class: "OTHER", value: cardDebt });

  return {
    byClass: Array.from(byClass, ([cls, total]) => ({ class: cls, total })).sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0)),
    liabilities,
    assetsTotal,
    liabilitiesTotal,
    net: assetsTotal - liabilitiesTotal,
  };
}

/**
 * Snapshot do mês de `today`: grava o valor atual de cada ativo e conta com a
 * data do último dia do mês. Idempotente: no mesmo mês, atualiza; meses passados
 * nunca são tocados — é o que faz o gráfico de evolução vir de foto, não de recálculo.
 */
export async function takeMonthlySnapshot(tx: UserDb, userId: string, today: ISODate = todayISO()): Promise<number> {
  const [y, m] = today.split("-").map(Number);
  const date = fromISODate(monthPeriod(y, m).end);
  const [accounts, assets] = await Promise.all([
    tx.account.findMany({ where: { userId, archived: false }, select: { id: true, currentBalance: true } }),
    tx.asset.findMany({ where: { userId, archived: false }, select: { id: true, currentValue: true, isLiability: true } }),
  ]);
  let written = 0;
  for (const a of assets) {
    const value = a.isLiability ? -a.currentValue : a.currentValue;
    await tx.netWorthSnapshot.upsert({
      where: { assetId_date: { assetId: a.id, date } },
      create: { userId, assetId: a.id, date, value },
      update: { value },
    });
    written++;
  }
  for (const a of accounts) {
    const existing = await tx.netWorthSnapshot.findFirst({ where: { accountId: a.id, date } });
    if (existing) await tx.netWorthSnapshot.update({ where: { id: existing.id }, data: { value: a.currentBalance } });
    else await tx.netWorthSnapshot.create({ data: { userId, accountId: a.id, date, value: a.currentBalance } });
    written++;
  }
  return written;
}

/** `net` nulo = mês anterior à primeira foto: o gráfico não desenha ponto. */
export type NetWorthPoint = { month: string; net: bigint | null };

/** Série mensal do patrimônio líquido, lida dos snapshots (12 pontos terminando em `endMonth`). */
export async function getNetWorthHistory(tx: UserDb, userId: string, endMonth: string, months = 12): Promise<NetWorthPoint[]> {
  const startMonth = addMonths(`${endMonth}-01`, -(months - 1)).slice(0, 7);
  const [sy, sm] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  const rows = await tx.$queryRaw<{ month: string; net: bigint }[]>`
    select to_char(s.date, 'YYYY-MM') as month, coalesce(sum(s.value), 0)::bigint as net
    from public.net_worth_snapshots s
    where s.user_id = ${userId}::uuid
      and s.date between ${fromISODate(monthPeriod(sy, sm).start)} and ${fromISODate(monthPeriod(ey, em).end)}
    group by 1
  `;
  const byMonth = new Map(rows.map((r) => [r.month, BigInt(r.net)]));
  const points: NetWorthPoint[] = [];
  let seen = false;
  for (let i = 0; i < months; i++) {
    const month = addMonths(`${endMonth}-01`, i - (months - 1)).slice(0, 7);
    const value = byMonth.get(month);
    if (value !== undefined) seen = true;
    // Antes da primeira foto não há ponto; depois, mês sem foto herda o anterior (a linha não cai a zero por falta de dado).
    points.push({ month, net: value ?? (seen ? points[i - 1].net : null) });
  }
  return points;
}
