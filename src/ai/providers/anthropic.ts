import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, ProviderContent, ProviderRequest, ProviderResponse } from "../provider";
import { ProviderUnavailableError } from "./errors";

export { ProviderUnavailableError };

function toBlock(c: ProviderContent): Anthropic.ContentBlockParam {
  if (c.type === "text") return { type: "text", text: c.text };
  if (c.type === "image") return { type: "image", source: { type: "base64", media_type: c.mediaType, data: c.base64 } };
  return { type: "document", source: { type: "base64", media_type: "application/pdf", data: c.base64 } };
}

/** Provedor Anthropic. Lê ANTHROPIC_API_KEY do ambiente; a chave nunca sai do servidor. */
export class AnthropicProvider implements LlmProvider {
  private client: Anthropic | null = null;

  private get sdk(): Anthropic {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new ProviderUnavailableError("ANTHROPIC_API_KEY ausente: a extração por IA está desligada.");
    }
    // Chave de organização (não de um workspace específico) exige este header.
    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
    this.client ??= new Anthropic({
      maxRetries: 2,
      timeout: 120_000,
      ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
    });
    return this.client;
  }

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    try {
      const isHaiku = req.model.includes("haiku");
      const response = await this.sdk.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.content.map(toBlock) }],
        // Extração é leitura, não raciocínio: esforço baixo mantém o custo por usuário controlado.
        ...(isHaiku ? {} : { thinking: { type: "disabled" as const }, output_config: { effort: "low" as const } }),
      });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return {
        text,
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        stopReason: response.stop_reason,
      };
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new ProviderUnavailableError("Chave da Anthropic inválida.");
      if (e instanceof Anthropic.RateLimitError) throw new ProviderUnavailableError("Provedor de IA sobrecarregado; tente em instantes.");
      throw e;
    }
  }
}
