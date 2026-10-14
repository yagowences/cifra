import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiClient, GEMINI_API_URL } from "./gemini-client";

/** O SDK expõe a URL que vai usar nas chamadas; é o que a Netlify acabava alterando por baixo. */
const baseUrlOf = (client: unknown) => (client as { apiClient: { getBaseUrl(): string } }).apiClient.getBaseUrl();

describe("createGeminiClient", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sem variável de ambiente, usa a URL do Google", () => {
    expect(baseUrlOf(createGeminiClient("k", 1000))).toBe(GEMINI_API_URL);
  });

  it("ignora GOOGLE_GEMINI_BASE_URL: o AI Gateway da Netlify injeta essa variável e rejeitaria a chave do Google", () => {
    vi.stubEnv("GOOGLE_GEMINI_BASE_URL", "https://gateway.exemplo.netlify.app/gemini");
    vi.stubEnv("GEMINI_API_KEY", "token-do-gateway");
    expect(baseUrlOf(createGeminiClient("k", 1000))).toBe(GEMINI_API_URL);
  });
});
