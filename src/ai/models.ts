/**
 * Provedor e modelos por tarefa. AI_PROVIDER escolhe o provedor ativo
 * (padrão: gemini, pelo free tier); os IDs de modelo são sobrescrevíveis
 * por env independente do provedor.
 */
export type AiProvider = "gemini" | "anthropic";

export const AI_PROVIDER: AiProvider = (process.env.AI_PROVIDER?.toLowerCase() as AiProvider) === "anthropic" ? "anthropic" : "gemini";

const DEFAULTS: Record<AiProvider, { extract: string; categorize: string; simple: string; answer: string }> = {
  // Aliases "-latest" da Google: sempre o modelo corrente da família, sem versão presa.
  // extract usa o flash-lite: testado contra um PDF real (fatura Nubank, 12 lançamentos,
  // saldo batendo), e o flash cheio andou devolvendo 503 de sobrecarga com frequência.
  gemini: { extract: "gemini-flash-lite-latest", categorize: "gemini-flash-latest", simple: "gemini-flash-lite-latest", answer: "gemini-flash-latest" },
  // Como a especificação pede: Sonnet para extração/categorização, Haiku para tarefas simples.
  anthropic: { extract: "claude-sonnet-5", categorize: "claude-sonnet-5", simple: "claude-haiku-4-5", answer: "claude-sonnet-5" },
};

const base = DEFAULTS[AI_PROVIDER];

/** Se a chave do provedor ativo está configurada — controla o que as telas de IA mostram. */
export const aiEnabled = () => Boolean(AI_PROVIDER === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.GOOGLE_API_KEY);

/** `.env` com a chave presente mas vazia vira string vazia, não undefined: trata os dois como "não definido". */
const envOr = (value: string | undefined, fallback: string) => (value && value.trim() ? value : fallback);

export const MODELS = {
  extract: envOr(process.env.AI_MODEL_EXTRACT, base.extract),
  categorize: envOr(process.env.AI_MODEL_CATEGORIZE, base.categorize),
  simple: envOr(process.env.AI_MODEL_SIMPLE, base.simple),
  answer: envOr(process.env.AI_MODEL_ANSWER, base.answer),
} as const;

/** Preço por milhão de tokens, em centavos de dólar. */
export const PRICE_CENTS_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 500, output: 2500 },
  "claude-sonnet-5": { input: 200, output: 1000 },
  "claude-haiku-4-5": { input: 100, output: 500 },
  // Free tier do Google AI Studio (chave sem faturamento ativado): sem custo, só limite de
  // requisições por minuto/dia. Ativou faturamento? troque para o preço pago atual do Gemini.
  "gemini-flash-latest": { input: 0, output: 0 },
  "gemini-flash-lite-latest": { input: 0, output: 0 },
  "gemini-pro-latest": { input: 0, output: 0 },
};
