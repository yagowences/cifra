export const THEME_COOKIE = "cifra-theme";

export type Theme = "dark" | "light";

/** Tema escuro é o padrão do produto: qualquer valor desconhecido cai nele. */
export function parseTheme(value: string | undefined | null): Theme {
  return value === "light" ? "light" : "dark";
}

export const otherTheme = (theme: Theme): Theme => (theme === "dark" ? "light" : "dark");
