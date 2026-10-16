import { addDays } from "@/lib/dates";
import { fingerprint, normalizeDescription } from "@/lib/fingerprint";
import type { ParsedRow, ReviewRow, RowStatus } from "./types";

/** O que a dedup precisa saber de uma transação já existente na conta. */
export type ExistingTx = {
  id: string;
  externalId: string | null;
  fingerprint: string;
  competenceDate: string;
  amount: string;
  description: string;
  status: "PENDING" | "CONFIRMED" | "RECONCILED" | "PROJECTED" | "IGNORED";
  installmentNo?: number | null;
  installmentTotal?: number | null;
};

/** Similaridade de Jaccard sobre trigramas da descrição normalizada, 0–1. */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = ` ${normalizeDescription(s)} `;
    const set = new Set<string>();
    for (let i = 0; i < t.length - 2; i++) set.add(t.slice(i, i + 3));
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

export type DedupeOptions = { accountId: string; fuzzyDays?: number; fuzzyThreshold?: number };

/**
 * Dedup em três níveis contra o que já existe na conta, parando no primeiro que decide:
 * 1. externalId igual → duplicata;
 * 2. fingerprint igual (conta|data|valor|descrição normalizada) → duplicata;
 * 3. mesmo valor, data ±3 dias e descrição parecida (> 0,85) → possível duplicata (a pessoa decide).
 * Previsão ou pendente com mesmo valor e data ±3 dias → "casada": vira a própria transação ao confirmar.
 * Linhas repetidas dentro do arquivo também são marcadas como duplicata.
 */
export function dedupeRows(rows: ParsedRow[], existing: ExistingTx[], opts: DedupeOptions): ReviewRow[] {
  const fuzzyDays = opts.fuzzyDays ?? 3;
  const threshold = opts.fuzzyThreshold ?? 0.85;
  const byExternal = new Map(existing.filter((e) => e.externalId).map((e) => [e.externalId!, e]));
  const byFingerprint = new Map(existing.map((e) => [e.fingerprint, e]));
  const seenInFile = new Set<string>();
  const claimed = new Set<string>();

  return rows.map((row, index) => {
    const fp = fingerprint({ accountId: opts.accountId, competenceDate: row.date, amount: BigInt(row.amount), description: row.description });
    const key = `${index}:${fp.slice(0, 12)}`;
    const decide = (status: RowStatus, matchId: string | null, matchReason: string | null): ReviewRow => ({
      ...row,
      key,
      status,
      matchId,
      matchReason,
      suggestedCategoryId: null,
      confidence: null,
    });

    const fileKey = row.externalId ?? fp;
    if (seenInFile.has(fileKey)) return decide("duplicate", null, "Repetido dentro do arquivo");
    seenInFile.add(fileKey);

    const byId = row.externalId ? byExternal.get(row.externalId) : undefined;
    if (byId) return decide("duplicate", byId.id, "Mesmo identificador do banco");

    const byFp = byFingerprint.get(fp);
    if (byFp) {
      // Parcela projetada pela fatura anterior chega com a mesma impressão digital: é ela que está
      // sendo confirmada, não uma duplicata.
      if ((byFp.status === "PROJECTED" || byFp.status === "PENDING") && !claimed.has(byFp.id)) {
        claimed.add(byFp.id);
        return decide("matched", byFp.id, "Bate com um lançamento previsto");
      }
      return decide("duplicate", byFp.id, "Mesma conta, data, valor e descrição");
    }

    // Parcela N de M com a projeção da série, mesmo que o valor (juros, IOF) ou a data tenham mudado um pouco.
    if (row.installmentNo && row.installmentTotal) {
      const series = existing.find(
        (e) =>
          (e.status === "PROJECTED" || e.status === "PENDING") &&
          !claimed.has(e.id) &&
          e.installmentNo === row.installmentNo &&
          e.installmentTotal === row.installmentTotal &&
          similarity(e.description, row.description) >= threshold,
      );
      if (series) {
        claimed.add(series.id);
        return decide("matched", series.id, "Parcela prevista pela fatura anterior");
      }
    }

    const from = addDays(row.date, -fuzzyDays);
    const to = addDays(row.date, fuzzyDays);
    const near = existing.filter((e) => e.amount === row.amount && e.competenceDate >= from && e.competenceDate <= to && !claimed.has(e.id));

    const projected = near.find((e) => e.status === "PROJECTED" || e.status === "PENDING");
    if (projected) {
      claimed.add(projected.id);
      return decide("matched", projected.id, "Bate com um lançamento previsto");
    }

    const similar = near
      .map((e) => ({ e, s: similarity(e.description, row.description) }))
      .filter((x) => x.s >= threshold)
      .sort((a, b) => b.s - a.s)[0];
    if (similar) return decide("possible_duplicate", similar.e.id, `Parecido com "${similar.e.description}" em data próxima`);

    return decide("new", null, null);
  });
}
