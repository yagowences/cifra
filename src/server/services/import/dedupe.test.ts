import { describe, expect, it } from "vitest";
import { fingerprint } from "@/lib/fingerprint";
import { dedupeRows, similarity, type ExistingTx } from "./dedupe";
import type { ParsedRow } from "./types";

const accountId = "acc";
const row = (over: Partial<ParsedRow>): ParsedRow => ({ externalId: null, date: "2026-09-10", amount: "-4290", description: "IFD*IFOOD SAO PAULO", memo: null, balanceAfter: null, ...over });
const existing = (over: Partial<ExistingTx> & { description: string; date: string; amount: string }): ExistingTx => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  externalId: over.externalId ?? null,
  fingerprint: fingerprint({ accountId, competenceDate: over.date, amount: BigInt(over.amount), description: over.description }),
  competenceDate: over.date,
  amount: over.amount,
  description: over.description,
  status: over.status ?? "CONFIRMED",
});

describe("similarity", () => {
  it("ignora caixa e acento e cai com textos diferentes", () => {
    expect(similarity("Padaria Vila Nova", "PADARIA VILA NOVA")).toBe(1);
    expect(similarity("IFD*IFOOD SAO PAULO", "IFD*IFOOD SAO PAULO 2")).toBeGreaterThan(0.85);
    expect(similarity("iFood", "Uber")).toBeLessThan(0.3);
  });
});

describe("dedupeRows", () => {
  it("nível 1: mesmo identificador do banco é duplicata", () => {
    const ex = existing({ id: "t1", externalId: "fit-1", description: "Outra descrição", date: "2026-01-01", amount: "-1" });
    const [r] = dedupeRows([row({ externalId: "fit-1" })], [ex], { accountId });
    expect(r).toMatchObject({ status: "duplicate", matchId: "t1", matchReason: "Mesmo identificador do banco" });
  });

  it("nível 2: mesmo fingerprint é duplicata, mesmo sem identificador", () => {
    const ex = existing({ id: "t2", description: " ifd*ifood sao paulo ", date: "2026-09-10", amount: "-4290" });
    const [r] = dedupeRows([row({})], [ex], { accountId });
    expect(r).toMatchObject({ status: "duplicate", matchId: "t2" });
  });

  it("nível 3: mesmo valor, data ±3 dias e descrição parecida é possível duplicata", () => {
    const ex = existing({ id: "t3", description: "IFD*IFOOD SAO PAULO BR", date: "2026-09-12", amount: "-4290" });
    const [r] = dedupeRows([row({})], [ex], { accountId });
    expect(r).toMatchObject({ status: "possible_duplicate", matchId: "t3" });

    const far = existing({ id: "t4", description: "IFD*IFOOD SAO PAULO BR", date: "2026-09-20", amount: "-4290" });
    expect(dedupeRows([row({})], [far], { accountId })[0].status).toBe("new");
  });

  it("previsão com mesmo valor em data próxima é casada e só uma linha a reivindica", () => {
    const projected = existing({ id: "p1", description: "Aluguel", date: "2026-09-05", amount: "-92840", status: "PROJECTED" });
    const rows = [row({ date: "2026-09-06", amount: "-92840", description: "TED ALUGUEL" }), row({ date: "2026-09-07", amount: "-92840", description: "TED ALUGUEL 2" })];
    const out = dedupeRows(rows, [projected], { accountId });
    expect(out[0]).toMatchObject({ status: "matched", matchId: "p1" });
    expect(out[1].status).toBe("new");
  });

  it("linha repetida dentro do arquivo é duplicata", () => {
    const out = dedupeRows([row({}), row({})], [], { accountId });
    expect(out.map((r) => r.status)).toEqual(["new", "duplicate"]);
    expect(out[1].matchReason).toBe("Repetido dentro do arquivo");
  });

  it("chaves são estáveis e únicas", () => {
    const out = dedupeRows([row({}), row({ amount: "-1" })], [], { accountId });
    expect(new Set(out.map((r) => r.key)).size).toBe(2);
  });
});
