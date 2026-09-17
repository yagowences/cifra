import { describe, expect, it } from "vitest";
import { isActive } from "./nav-items";

describe("isActive", () => {
  it("marca a rota e suas filhas", () => {
    expect(isActive("/importar", "/importar")).toBe(true);
    expect(isActive("/importar/abc", "/importar")).toBe(true);
  });

  it("não marca o início em rotas internas nem prefixos parecidos", () => {
    expect(isActive("/transacoes", "/")).toBe(false);
    expect(isActive("/metas-antigas", "/metas")).toBe(false);
  });
});
