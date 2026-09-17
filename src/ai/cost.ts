import { PRICE_CENTS_PER_MTOK } from "./models";

/** Custo de uma chamada em centavos de dólar, arredondado para cima (nunca subestima). */
export function costCents(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICE_CENTS_PER_MTOK[model];
  if (!price) throw new Error(`Sem tabela de preço para o modelo ${model}`);
  const cents = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return Math.ceil(cents * 100) / 100;
}

/** Orçamento mensal por usuário, em centavos de dólar (AI_MONTHLY_BUDGET_CENTS_PER_USER, padrão 50). */
export function monthlyBudgetCents(): number {
  const raw = Number(process.env.AI_MONTHLY_BUDGET_CENTS_PER_USER ?? 50);
  return Number.isFinite(raw) && raw >= 0 ? raw : 50;
}
