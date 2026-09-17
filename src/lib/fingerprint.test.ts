import { describe, expect, it } from "vitest";
import { fingerprint, normalizeDescription } from "./fingerprint";

describe("normalizeDescription", () => {
  it("ignora caixa, acento, pontuação e espaços extras", () => {
    expect(normalizeDescription("  PÃO de AÇÚCAR - Loja  12 ")).toBe("pao de acucar loja 12");
    expect(normalizeDescription("iFood*IFOOD")).toBe("ifood ifood");
  });
});

describe("fingerprint", () => {
  const base = { accountId: "acc_1", competenceDate: "2026-09-17", amount: -4890n, description: "iFood" };

  it("é estável e insensível a variações cosméticas da descrição", () => {
    expect(fingerprint(base)).toBe(fingerprint({ ...base, description: " IFOOD " }));
    expect(fingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("muda com conta, data, valor ou descrição", () => {
    expect(fingerprint({ ...base, accountId: "acc_2" })).not.toBe(fingerprint(base));
    expect(fingerprint({ ...base, competenceDate: "2026-09-18" })).not.toBe(fingerprint(base));
    expect(fingerprint({ ...base, amount: -4891n })).not.toBe(fingerprint(base));
    expect(fingerprint({ ...base, description: "Uber" })).not.toBe(fingerprint(base));
  });
});
