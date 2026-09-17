/**
 * Gera src/styles/tokens.css a partir de design-system/tokens.json.
 * A fonte da verdade visual é o JSON do Design System: nenhum hexadecimal
 * é escrito à mão em CSS ou componente.
 *
 * Uso: npm run tokens
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const themedValue = z.object({ dark: z.string(), light: z.string() });
const aliasValue = z.string().regex(/^\{[a-z0-9-]+\}$/, "alias deve ter o formato {token}");

const typeStyle = z.object({
  name: z.string(),
  fontSize: z.string(),
  lineHeight: z.string(),
  fontWeight: z.number(),
  letterSpacing: z.string().optional(),
});

export const tokensSchema = z.object({
  color: z.object({
    tokens: z.array(z.object({ name: z.string(), value: z.union([themedValue, aliasValue]) })),
  }),
  type: z.object({ groups: z.array(z.object({ styles: z.array(typeStyle) })) }),
  radius: z.object({ tokens: z.array(z.object({ name: z.string(), value: z.string() })) }),
  shadow: z.object({ tokens: z.array(z.object({ name: z.string(), value: themedValue })) }),
});

export type DesignTokens = z.infer<typeof tokensSchema>;

type Theme = "dark" | "light";

export function buildTokensCss(raw: unknown): string {
  const tokens = tokensSchema.parse(raw);
  const colorNames = new Set(tokens.color.tokens.map((t) => t.name));

  const colorValue = (value: DesignTokens["color"]["tokens"][number]["value"], theme: Theme) => {
    if (typeof value !== "string") return value[theme];
    const target = value.slice(1, -1);
    if (!colorNames.has(target)) throw new Error(`Alias para token inexistente: ${value}`);
    return `var(--${target})`;
  };

  const themeBlock = (theme: Theme) =>
    [
      ...tokens.color.tokens.map((t) => `  --${t.name}: ${colorValue(t.value, theme)};`),
      ...tokens.shadow.tokens.map((t) => `  --${t.name}: ${t.value[theme]};`),
    ].join("\n");

  const themeMap = [
    ...tokens.color.tokens.map((t) => `  --color-${t.name}: var(--${t.name});`),
    // Nome usado na especificação de Tailwind (brand.on → text-brand-on).
    ...(colorNames.has("on-brand") ? ["  --color-brand-on: var(--on-brand);"] : []),
    ...tokens.radius.tokens.map((t) => `  --${t.name}: ${t.value};`),
    ...tokens.type.groups.flatMap((g) =>
      g.styles.flatMap((s) => [
        `  --text-${s.name}: ${s.fontSize};`,
        `  --text-${s.name}--line-height: ${s.lineHeight};`,
        `  --text-${s.name}--font-weight: ${s.fontWeight};`,
        ...(s.letterSpacing ? [`  --text-${s.name}--letter-spacing: ${s.letterSpacing};`] : []),
      ]),
    ),
  ].join("\n");

  // Sombra fica fora do @theme: o nome da variável de runtime colidiria com o do tema.
  const shadowUtilities = tokens.shadow.tokens
    .map((t) => `@utility ${t.name} {\n  box-shadow: var(--${t.name});\n}`)
    .join("\n\n");

  return `/* GERADO por scripts/build-tokens.ts a partir de design-system/tokens.json. Não editar à mão. */

:root,
[data-theme="dark"] {
  color-scheme: dark;
${themeBlock("dark")}
}

[data-theme="light"] {
  color-scheme: light;
${themeBlock("light")}
}

@theme inline {
${themeMap}
}

${shadowUtilities}
`;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const input = resolve(root, "design-system/tokens.json");
  const output = resolve(root, "src/styles/tokens.css");
  const css = buildTokensCss(JSON.parse(readFileSync(input, "utf8")));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, css);
  console.log(`tokens.css gerado em ${output}`);
}
