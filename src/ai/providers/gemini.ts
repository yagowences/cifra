import "server-only";
import { ApiError, GoogleGenAI, FinishReason, type Part } from "@google/genai";
import type { LlmProvider, ProviderContent, ProviderRequest, ProviderResponse } from "../provider";
import { ProviderUnavailableError } from "./errors";

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
    this.client ??= new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
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
      if (e instanceof ApiError) {
        if (e.status === 401 || e.status === 403) throw new ProviderUnavailableError("Chave do Gemini inválida ou sem permissão.");
        if (e.status === 429) throw new ProviderUnavailableError("Limite gratuito do Gemini atingido por agora; tente mais tarde.");
      }
      throw e;
    }
  }
}

export { FinishReason as GeminiFinishReason };
