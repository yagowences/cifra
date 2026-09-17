import { describe, expect, it } from "vitest";
import { costCents } from "./cost";

describe("costCents", () => {
  it("calcula pelo preço do modelo e arredonda para cima em centésimos de centavo", () => {
    // Sonnet 5: 200 c/MTok entrada, 1000 c/MTok saída.
    expect(costCents("claude-sonnet-5", 10_000, 1_000)).toBe(3);
    expect(costCents("claude-haiku-4-5", 1_000, 100)).toBe(0.15);
    expect(costCents("claude-sonnet-5", 1, 1)).toBe(0.01);
  });

  it("modelo sem preço é erro, nunca custo zero", () => {
    expect(() => costCents("modelo-x", 1, 1)).toThrow(/preço/);
  });
});
