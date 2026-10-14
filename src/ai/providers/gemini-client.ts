import { GoogleGenAI } from "@google/genai";

export const GEMINI_API_URL = "https://generativelanguage.googleapis.com";

/**
 * Cliente do Gemini com a URL do Google fixada. O SDK lê GOOGLE_GEMINI_BASE_URL do ambiente, e o AI
 * Gateway da Netlify injeta essa variável (e uma GEMINI_API_KEY própria) em toda function: sem a
 * `baseUrl` explícita, a chave do Google é enviada ao proxy da Netlify, que a rejeita com um 401
 * `{"message":"","status":"Unauthorized"}` — funcionava na máquina local e falhava só em produção.
 * Além de quebrar, o gateway é um caminho que pode consumir créditos da Netlify.
 */
export function createGeminiClient(apiKey: string, timeoutMs: number): GoogleGenAI {
  return new GoogleGenAI({ apiKey, httpOptions: { baseUrl: GEMINI_API_URL, timeout: timeoutMs } });
}
