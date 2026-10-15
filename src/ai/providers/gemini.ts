import "server-only";
import { FinishReason, type GoogleGenAI, type Part } from "@google/genai";
import type { LlmProvider, ProviderContent, ProviderRequest, ProviderResponse } from "../provider";
import { friendlyGeminiError, ProviderUnavailableError } from "./errors";
import { createGeminiClient } from "./gemini-client";

function toPart(c: ProviderContent): Part {
  if (c.type === "text") return { text: c.text };
  if (c.type === "image") return { inlineData: { data: c.base64, mimeType: c.mediaType } };
  return { inlineData: { data: c.base64, mimeType: "application/pdf" } };
}

/** Provedor Google Gemini. Lê GOOGLE_API_KEY do ambiente; a chave nunca sai do servidor. */
export class GeminiProvider implements LlmProvider {
  private client: GoogleGenAI | null = null;

  private get sdk(): GoogleGenAI {
    if (!process.env.GOOGLE_API_KEY) {
      throw new ProviderUnavailableError("GOOGLE_API_KEY ausente: a extração por IA está desligada.");
    }
    // Sem timeout, uma rede instável deixa a chamada pendurada por minutos (visto: HeadersTimeoutError
    // do undici bem depois de 60s). O teto também precisa caber no limite de execução de uma function
    // da Netlify, que não é configurável e na prática é de ~30 s (visto: 502 aos 30,6 s). A leitura de
    // uma fatura de 72 linhas leva 12-16 s; 20 s deixa folga para enviar, salvar e responder.
    this.client ??= createGeminiClient(process.env.GOOGLE_API_KEY, 20_000);
    return this.client;
  }

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    try {
      const response = await this.sdk.models.generateContent({
        model: req.model,
        contents: [{ role: "user", parts: req.content.map(toPart) }],
        config: { systemInstruction: req.system, maxOutputTokens: req.maxTokens },
      });
      const finish = response.candidates?.[0]?.finishReason ?? null;
      return {
        text: response.text ?? "",
        model: req.model,
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        stopReason: finish,
      };
    } catch (e) {
      throw friendlyGeminiError(e);
    }
  }
}

export { FinishReason as GeminiFinishReason };
