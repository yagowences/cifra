import { ApiError } from "@google/genai";

/**
 * Erro comum a qualquer provedor: chave ausente, inválida, ou sobrecarregado.
 * `retryable` separa o que some sozinho em segundos (sobrecarga) do que repetir não resolve
 * (chave inválida, cota esgotada), para o cliente de IA saber quando vale tentar de novo.
 */
export class ProviderUnavailableError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

/** O SDK devolve o corpo da resposta do Google como JSON dentro de `message`; tira só o motivo. */
function googleReason(e: ApiError): string {
  try {
    const body = JSON.parse(e.message) as { error?: { status?: string; message?: string } };
    const reason = [body.error?.status, body.error?.message].filter(Boolean).join(": ");
    if (reason) return reason.slice(0, 220);
  } catch {
    // corpo não era JSON: cai no texto cru
  }
  return e.message.slice(0, 220);
}

/**
 * Traduz um erro do SDK do Gemini pra uma mensagem que faz sentido pra quem usa o app, em vez do
 * JSON cru da API (`{"error":{"code":503,...}}`) vazando até a tela de revisão da importação.
 *
 * No 401/403 o motivo do Google acompanha a mensagem: ele distingue causas que a frase amigável
 * junta (chave errada × chave restrita por IP/site × conta sem acesso ao modelo) e é o que permite
 * diagnosticar uma falha que só acontece no ambiente publicado. Não contém a chave.
 */
export function friendlyGeminiError(e: unknown): Error {
  if (e instanceof ApiError) {
    console.error(`[gemini] ${e.status}: ${e.message}`);
    if (e.status === 401 || e.status === 403) return new ProviderUnavailableError(`Chave do Gemini inválida ou sem permissão (Google: ${googleReason(e)}).`);
    if (e.status === 429) return new ProviderUnavailableError("Limite gratuito do Gemini atingido por agora; tente mais tarde.");
    if (e.status === 503 || e.status === 502 || e.status === 504) return new ProviderUnavailableError("O Gemini está sobrecarregado agora. Tente de novo em alguns minutos.", true);
  }
  return e instanceof Error ? e : new Error(String(e));
}
