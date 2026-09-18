import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { ApiError, FinishReason, GoogleGenAI, type Content, type FunctionDeclaration, type Part } from "@google/genai";
import type { ChatModel } from "../assistant";
import { ProviderUnavailableError } from "./errors";

/** Carrega a assinatura de "pensamento" do Gemini num tool_use, já que Anthropic.ToolUseBlock não tem campo pra isso. */
type GeminiToolUseBlock = Anthropic.ToolUseBlock & { thoughtSignature?: string };

/**
 * Faz o loop de ferramentas de assistant.ts (escrito contra o formato da
 * Anthropic) rodar sobre o Gemini: traduz Tool/MessageParam → FunctionDeclaration/
 * Content na ida, e a resposta do Gemini de volta para o formato Anthropic.Message
 * na volta. O loop em si (executeTool, histórico, links) não muda de provedor
 * para provedor — só esta borda de tradução muda.
 */
export class GeminiChatModel implements ChatModel {
  private client: GoogleGenAI | null = null;

  private get sdk(): GoogleGenAI {
    if (!process.env.GOOGLE_API_KEY) throw new ProviderUnavailableError("GOOGLE_API_KEY ausente: o assistente está desligado.");
    this.client ??= new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    return this.client;
  }

  async create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
    const tools: FunctionDeclaration[] = (params.tools ?? []).map((t) => {
      const tool = t as Anthropic.Tool;
      return { name: tool.name, description: tool.description, parametersJsonSchema: tool.input_schema };
    });
    const contents = toGeminiContents(params.messages);

    try {
      const response = await this.sdk.models.generateContent({
        model: params.model,
        contents,
        config: {
          systemInstruction: typeof params.system === "string" ? params.system : undefined,
          maxOutputTokens: params.max_tokens,
          tools: tools.length ? [{ functionDeclarations: tools }] : undefined,
          // "disabled" do lado Anthropic → thinkingBudget 0: sem isso o Gemini pensa por padrão,
          // assina a chamada de ferramenta (thoughtSignature) e exige a assinatura de volta no
          // próximo turno — que o formato Anthropic.ToolUseBlock não tem onde guardar.
          thinkingConfig: params.thinking?.type === "disabled" ? { thinkingBudget: 0 } : undefined,
        },
      });
      return toAnthropicMessage(response, params.model);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401 || e.status === 403) throw new ProviderUnavailableError("Chave do Gemini inválida ou sem permissão.");
        if (e.status === 429) throw new ProviderUnavailableError("Limite gratuito do Gemini atingido por agora; tente mais tarde.");
      }
      throw e;
    }
  }
}

function toGeminiContents(messages: Anthropic.MessageParam[]): Content[] {
  // tool_use.id → name, para dar nome ao functionResponse correspondente (Gemini casa por id, mas pede name também).
  const nameById = new Map<string, string>();
  return messages.map((m): Content => {
    const role = m.role === "assistant" ? "model" : "user";
    if (typeof m.content === "string") return { role, parts: [{ text: m.content }] };

    const parts: Part[] = m.content.map((block) => {
      if (block.type === "text") return { text: block.text };
      if (block.type === "tool_use") {
        nameById.set(block.id, block.name);
        const thoughtSignature = (block as GeminiToolUseBlock).thoughtSignature;
        return { functionCall: { id: block.id, name: block.name, args: block.input as Record<string, unknown> }, ...(thoughtSignature ? { thoughtSignature } : {}) };
      }
      if (block.type === "tool_result") {
        const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
        return {
          functionResponse: {
            id: block.tool_use_id,
            name: nameById.get(block.tool_use_id) ?? "unknown",
            response: block.is_error ? { error: text } : safeJsonObject(text),
          },
        };
      }
      return { text: "" };
    });
    return { role, parts };
  });
}

/** functionResponse.response precisa ser um objeto; embrulha valores que não são. */
function safeJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { output: parsed };
  } catch {
    return { output: text };
  }
}

function toAnthropicMessage(response: Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>, model: string): Anthropic.Message {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const content: Anthropic.ContentBlock[] = [];
  for (const part of parts) {
    if (part.text) content.push({ type: "text", text: part.text, citations: null });
    if (part.functionCall) {
      content.push({
        type: "tool_use",
        id: part.functionCall.id ?? `call_${Math.random().toString(36).slice(2)}`,
        name: part.functionCall.name ?? "unknown",
        input: part.functionCall.args ?? {},
        // O SDK da Anthropic marca a origem da chamada; aqui é sempre direta (sem servidor MCP).
        caller: { type: "direct" },
        ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
      } as GeminiToolUseBlock);
    }
  }

  const finish = response.candidates?.[0]?.finishReason;
  const hasToolUse = content.some((b) => b.type === "tool_use");
  const stop_reason: Anthropic.Message["stop_reason"] = hasToolUse
    ? "tool_use"
    : finish === FinishReason.MAX_TOKENS
      ? "max_tokens"
      : finish === FinishReason.SAFETY || finish === FinishReason.PROHIBITED_CONTENT
        ? "refusal"
        : "end_turn";

  return {
    id: `gemini_${Math.random().toString(36).slice(2)}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: response.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      service_tier: null,
    },
  } as Anthropic.Message;
}
