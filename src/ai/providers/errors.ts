import { ApiError } from "@google/genai";

/** Erro comum a qualquer provedor: chave ausente, inválida, ou sobrecarregado. */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

/**
 * Traduz um erro do SDK do Gemini pra uma mensagem que faz sentido pra quem usa o app, em vez do
 * JSON cru da API (`{"error":{"code":503,...}}`) vazando até a tela de revisão da importação.
 * A mensagem original do Google vai pro log do servidor: ela distingue causas que a mensagem
 * amigável junta (chave errada × chave restrita por IP × conta sem acesso ao modelo), e sem isso
 * não dá para diagnosticar uma falha que só acontece no ambiente publicado.
 */
export function friendlyGeminiError(e: unknown): Error {
  if (e instanceof ApiError) {
    console.error(`[gemini] ${e.status}: ${e.message}`);
    if (e.status === 401 || e.status === 403) return new ProviderUnavailableError("Chave do Gemini inválida ou sem permissão.");
    if (e.status === 429) return new ProviderUnavailableError("Limite gratuito do Gemini atingido por agora; tente mais tarde.");
    if (e.status === 503 || e.status === 502 || e.status === 504) return new ProviderUnavailableError("O Gemini está sobrecarregado agora. Tente de novo em alguns minutos.");
  }
  return e instanceof Error ? e : new Error(String(e));
}
