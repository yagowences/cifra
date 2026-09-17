import { describe, expect, it } from "vitest";
import { otherTheme, parseTheme } from "./theme";

describe("parseTheme", () => {
  it("lê o tema claro salvo", () => {
    expect(parseTheme("light")).toBe("light");
  });

  it("cai no escuro para valor ausente ou inválido", () => {
    expect(parseTheme(undefined)).toBe("dark");
    expect(parseTheme("sepia")).toBe("dark");
  });

  it("alterna entre os dois temas", () => {
    expect(otherTheme("dark")).toBe("light");
    expect(otherTheme("light")).toBe("dark");
  });
});
