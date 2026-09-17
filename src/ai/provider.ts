/**
 * Fronteira única com o provedor de modelo. Nenhuma rota fala com a SDK
 * direto: é o que permite trocar de modelo, medir custo e fazer fallback.
 */
export type ProviderContent =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string }
  | { type: "pdf"; base64: string };

export type ProviderRequest = {
  model: string;
  system: string;
  content: ProviderContent[];
  maxTokens: number;
};

export type ProviderResponse = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
};

export interface LlmProvider {
  complete(req: ProviderRequest): Promise<ProviderResponse>;
}
