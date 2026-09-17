import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTokensCss } from "./build-tokens";

const tokensPath = resolve(__dirname, "../design-system/tokens.json");
const tokens: unknown = JSON.parse(readFileSync(tokensPath, "utf8"));

const block = (css: string, selector: string) => {
  const start = css.indexOf(selector);
  return css.slice(start, css.indexOf("}", start));
};

describe("buildTokensCss", () => {
  const css = buildTokensCss(tokens);

  it("gera o tema escuro como padrão e o claro sob data-theme", () => {
    const dark = block(css, ':root,\n[data-theme="dark"]');
    const light = block(css, '[data-theme="light"] {');
    expect(dark).toContain("--surface-base: #0b0f0d;");
    expect(dark).toContain("--brand: #35c48b;");
    expect(light).toContain("--surface-base: #f7f8f7;");
    expect(light).toContain("--brand: #0b7a55;");
  });

  it("resolve aliases como referência ao token de origem", () => {
    expect(css).toContain("--positive: var(--brand);");
    expect(css).toContain("--chart-1: var(--brand);");
  });

  it("expõe cores, raios, tipografia e sombras para o Tailwind", () => {
    expect(css).toContain("--color-surface-raised: var(--surface-raised);");
    expect(css).toContain("--color-brand-on: var(--on-brand);");
    expect(css).toContain("--radius-lg: 16px;");
    expect(css).toContain("--text-amount-hero: 36px;");
    expect(css).toContain("--text-amount-hero--letter-spacing: -0.02em;");
    expect(css).toContain("@utility shadow-card");
  });

  it("o CSS versionado está em dia com o tokens.json", () => {
    const committed = readFileSync(resolve(__dirname, "../src/styles/tokens.css"), "utf8");
    expect(committed.replace(/\r\n/g, "\n")).toBe(css);
  });

  it("rejeita alias para token inexistente", () => {
    const broken = structuredClone(tokens) as { color: { tokens: { name: string; value: unknown }[] } };
    broken.color.tokens.push({ name: "fantasma", value: "{nao-existe}" });
    expect(() => buildTokensCss(broken)).toThrow("Alias para token inexistente");
  });

  it("rejeita cor sem valor para um dos temas", () => {
    const broken = structuredClone(tokens) as { color: { tokens: { name: string; value: unknown }[] } };
    broken.color.tokens[0].value = { dark: "#000000" };
    expect(() => buildTokensCss(broken)).toThrow();
  });
});
