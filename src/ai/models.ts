/**
 * Modelos por tarefa, como a especificação pede: Sonnet para extração e
 * categorização, Haiku para tarefas simples. Sobrescrevíveis por ambiente.
 */
export const MODELS = {
  extract: process.env.AI_MODEL_EXTRACT ?? "claude-sonnet-5",
  categorize: process.env.AI_MODEL_CATEGORIZE ?? "claude-sonnet-5",
  simple: process.env.AI_MODEL_SIMPLE ?? "claude-haiku-4-5",
  answer: process.env.AI_MODEL_ANSWER ?? "claude-sonnet-5",
} as const;

/** Preço por milhão de tokens, em centavos de dólar (tabela de 2026-06). */
export const PRICE_CENTS_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 500, output: 2500 },
  "claude-sonnet-5": { input: 200, output: 1000 },
  "claude-haiku-4-5": { input: 100, output: 500 },
};
