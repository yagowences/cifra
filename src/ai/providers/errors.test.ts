import { ApiError } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { friendlyGeminiError, ProviderUnavailableError } from "./errors";

const apiError = (status: number, error: { status: string; message: string }) => new ApiError({ status, message: JSON.stringify({ error: { code: status, ...error } }) });

describe("friendlyGeminiError", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});

  it("403 carrega o motivo do Google, que distingue chave errada de chave restrita", () => {
    const err = friendlyGeminiError(apiError(403, { status: "PERMISSION_DENIED", message: "Requests from referer <empty> are blocked." }));
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect(err.message).toContain("PERMISSION_DENIED: Requests from referer <empty> are blocked.");
    expect((err as ProviderUnavailableError).retryable).toBe(false);
  });

  it("corpo que não é JSON cai no texto cru em vez de estourar", () => {
    const err = friendlyGeminiError(new ApiError({ status: 401, message: "texto solto" }));
    expect(err.message).toContain("texto solto");
  });

  it("só sobrecarga (502/503/504) é repetível; cota e chave não", () => {
    const retryable = (status: number) => (friendlyGeminiError(apiError(status, { status: "X", message: "y" })) as ProviderUnavailableError).retryable;
    expect([502, 503, 504].map(retryable)).toEqual([true, true, true]);
    expect([401, 403, 429].map(retryable)).toEqual([false, false, false]);
  });

  it("timeout e falha de rede viram mensagem legível e repetível, não o erro cru do fetch", () => {
    const abort = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    const headers = Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } });
    const rede = new TypeError("fetch failed");
    for (const e of [abort, headers]) {
      const err = friendlyGeminiError(e) as ProviderUnavailableError;
      expect(err.message).toContain("demorou demais");
      expect(err.retryable).toBe(true);
    }
    const err = friendlyGeminiError(rede) as ProviderUnavailableError;
    expect(err.message).toContain("falha de rede");
    expect(err.retryable).toBe(true);
  });

  it("erro que não é do Google passa intacto", () => {
    const original = new Error("rede caiu");
    expect(friendlyGeminiError(original)).toBe(original);
  });
});
