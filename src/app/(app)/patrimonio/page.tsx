import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PainelPatrimonio, type PatrimonioData } from "@/components/networth/painel-patrimonio";
import type { AssetListItem } from "@/lib/assets";
import { todayISO } from "@/lib/dates";
import { percentChange, percentOf } from "@/lib/money";
import { requireUserId } from "@/server/auth";
import { forUser } from "@/server/db";
import { getNetWorth, getNetWorthHistory, listAssets, takeMonthlySnapshot } from "@/server/services/networth";

export const metadata: Metadata = { title: "Patrimônio" };

export default async function PatrimonioPage() {
  const userId = await requireUserId();
  const today = todayISO();

  const { position, history, assets } = await forUser(userId, async (tx) => {
    // A foto do mês corrente acompanha o valor de hoje; as anteriores ficam como estavam.
    await takeMonthlySnapshot(tx, userId, today);
    return {
      position: await getNetWorth(tx, userId),
      history: await getNetWorthHistory(tx, userId, today.slice(0, 7), 12),
      assets: await listAssets(tx, userId),
    };
  });

  const first = history.find((h) => h.net !== null);
  const data: PatrimonioData = {
    net: position.net.toString(),
    assetsTotal: position.assetsTotal.toString(),
    liabilitiesTotal: position.liabilitiesTotal.toString(),
    variation12m: first && first.net && first.net !== 0n && first.month !== history[history.length - 1].month ? percentChange(first.net, position.net) : null,
    byClass: position.byClass.map((c) => ({ class: c.class, total: c.total.toString(), percent: percentOf(c.total, position.assetsTotal) })),
    liabilities: position.liabilities.map((l) => ({ ...l, value: l.value.toString() })),
    history: history.map((h) => ({ month: h.month, net: h.net === null ? null : h.net.toString() })),
    assets: assets.map<AssetListItem>((a) => ({ id: a.id, name: a.name, class: a.class, currentValue: a.currentValue.toString(), isLiability: a.isLiability })),
  };

  return (
    <>
      <PageHeader title="Patrimônio" />
      <PainelPatrimonio data={data} />
    </>
  );
}
