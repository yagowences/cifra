import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { formatMonthYear, monthPeriod, todayISO, type ISODate } from "@/lib/dates";
import { formatBRL, formatPercent } from "@/lib/money";
import { forUser } from "@/server/db";
import { comparePeriods, getAccountsBalance, getByCategory, getMonthlyFlow, getSummary, periodForMonth } from "@/server/queries/summary";
import { listTransactions } from "@/server/queries/transactions";
import { getNetWorth } from "@/server/services/networth";
import { assertAiAllowed, logAiUsage } from "./client";
import { costCents } from "./cost";
import { MODELS } from "./models";
import { ProviderUnavailableError } from "./providers/anthropic";

/**
 * Assistente: o modelo nunca calcula e nunca vê o banco inteiro. Ele escolhe
 * ferramentas; as ferramentas rodam as mesmas queries do dashboard com o
 * userId vindo do servidor; o modelo redige em cima do que voltou.
 */

/** Abstração mínima sobre o provedor para o loop ser testável sem rede. */
export interface ChatModel {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

export class AnthropicChatModel implements ChatModel {
  private client: Anthropic | null = null;
  create(params: Anthropic.MessageCreateParamsNonStreaming) {
    if (!process.env.ANTHROPIC_API_KEY) throw new ProviderUnavailableError("ANTHROPIC_API_KEY ausente: o assistente está desligado.");
    this.client ??= new Anthropic({ maxRetries: 2, timeout: 60_000 });
    return this.client.messages.create(params);
  }
}

export type ChatTurn = { role: "user" | "assistant"; text: string };
export type AnswerLink = { label: string; href: string };
export type Answer = {
  text: string;
  /** Toda resposta com número traz link para as transações que o compõem. */
  links: AnswerLink[];
  chart: { month: string; income: string; expense: string; result: string }[] | null;
  costCents: number;
  toolsUsed: string[];
};

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_summary",
    description: "Entradas, saídas, resultado (o que sobrou) e taxa de poupança de um mês. Use para 'quanto sobrou', 'quanto gastei', 'quanto entrou'.",
    input_schema: { type: "object", properties: { month: { type: "string", description: "Mês no formato YYYY-MM" } }, required: ["month"], additionalProperties: false },
    strict: true,
  },
  {
    name: "get_by_category",
    description: "Gastos (ou receitas) de um mês por categoria, do maior para o menor, com percentual. Use para 'maiores gastos', 'quanto gastei com X'.",
    input_schema: {
      type: "object",
      properties: { month: { type: "string" }, type: { type: "string", enum: ["EXPENSE", "INCOME"] }, limit: { type: "integer", minimum: 1, maximum: 20 } },
      required: ["month", "type", "limit"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "compare_periods",
    description: "Variação por categoria entre dois meses (antes e depois), maior aumento primeiro. Use para 'o que subiu', 'comparado com o mês passado'.",
    input_schema: { type: "object", properties: { before: { type: "string" }, after: { type: "string" } }, required: ["before", "after"], additionalProperties: false },
    strict: true,
  },
  {
    name: "list_transactions",
    description: "Lista de lançamentos de um mês, filtrável por categoria (nome), tipo e texto. Devolve até 20 e o total encontrado.",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string" },
        category: { type: ["string", "null"], description: "Nome da categoria, ou null" },
        type: { type: ["string", "null"], enum: ["EXPENSE", "INCOME", "TRANSFER", null] },
        q: { type: ["string", "null"], description: "Trecho da descrição, ou null" },
      },
      required: ["month", "category", "type", "q"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_monthly_flow",
    description: "Série mensal de entradas, saídas e resultado dos últimos N meses (2 a 12). Use para tendência, média de meses, 'últimos seis meses'.",
    input_schema: { type: "object", properties: { end_month: { type: "string" }, months: { type: "integer", minimum: 2, maximum: 12 } }, required: ["end_month", "months"], additionalProperties: false },
    strict: true,
  },
  {
    name: "get_net_worth",
    description: "Patrimônio líquido atual: ativos por classe, dívidas e saldo total das contas.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
];

const money = (c: bigint) => formatBRL(c);
const monthLabel = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  return formatMonthYear(y, mm);
};
const listHref = (month: string, extra: Record<string, string | null | undefined> = {}) => {
  const p = new URLSearchParams({ mes: month });
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return `/transacoes?${p.toString()}`;
};

type ToolOutcome = { result: unknown; links: AnswerLink[]; chart?: Answer["chart"] };

/** Executa uma ferramenta com o userId do servidor. O modelo nunca recebe o userId nem escreve SQL. */
export async function executeTool(userId: string, name: string, input: unknown): Promise<ToolOutcome> {
  return forUser(userId, async (tx) => {
    switch (name) {
      case "get_summary": {
        const { month } = z.object({ month: monthSchema }).parse(input);
        const s = await getSummary(tx, userId, periodForMonth(month));
        return {
          result: { month: monthLabel(month), income: money(s.income), expense: money(s.expense), result: money(s.result), savingsRate: formatPercent(s.savingsRate) },
          links: [{ label: `Ver transações de ${monthLabel(month).toLowerCase()}`, href: listHref(month) }],
        };
      }
      case "get_by_category": {
        const { month, type, limit } = z.object({ month: monthSchema, type: z.enum(["EXPENSE", "INCOME"]), limit: z.number().int().min(1).max(20) }).parse(input);
        const rows = await getByCategory(tx, userId, periodForMonth(month), type, limit);
        return {
          result: { month: monthLabel(month), categories: rows.map((r) => ({ name: r.name, total: money(r.total), percent: formatPercent(r.percent) })) },
          links: rows.slice(0, 3).map((r) => ({ label: `Ver ${r.name.toLowerCase()} em ${monthLabel(month).toLowerCase()}`, href: listHref(month, { tipo: type, categoria: r.isOthers ? null : (r.categoryId ?? "nenhuma") }) })),
        };
      }
      case "compare_periods": {
        const { before, after } = z.object({ before: monthSchema, after: monthSchema }).parse(input);
        const rows = await comparePeriods(tx, userId, periodForMonth(before), periodForMonth(after));
        return {
          result: {
            before: monthLabel(before),
            after: monthLabel(after),
            categories: rows.slice(0, 10).map((r) => ({ name: r.name, before: money(r.before), after: money(r.after), delta: formatBRL(r.delta, { sign: true }), deltaPercent: r.deltaPercent === null ? null : formatPercent(r.deltaPercent, { sign: true }) })),
          },
          links: [
            { label: `Ver ${monthLabel(after).toLowerCase()}`, href: listHref(after, { tipo: "EXPENSE" }) },
            { label: `Ver ${monthLabel(before).toLowerCase()}`, href: listHref(before, { tipo: "EXPENSE" }) },
          ],
        };
      }
      case "list_transactions": {
        const { month, category, type, q } = z
          .object({ month: monthSchema, category: z.string().nullable(), type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]).nullable(), q: z.string().nullable() })
          .parse(input);
        let categoryId: string | undefined;
        if (category) {
          const found = await tx.category.findFirst({ where: { userId, name: { equals: category, mode: "insensitive" } }, select: { id: true } });
          categoryId = found?.id ?? "nenhuma";
        }
        const page = await listTransactions(tx, userId, { month, categoryId, type: type ?? undefined, q: q ?? undefined, limit: 20 });
        const total = page.items.reduce((s, t) => s + BigInt(t.amount), 0n);
        return {
          result: {
            month: monthLabel(month),
            count: page.items.length,
            hasMore: page.nextCursor !== null,
            total: formatBRL(total, { sign: true }),
            transactions: page.items.map((t) => ({ date: t.competenceDate, description: t.description, amount: formatBRL(BigInt(t.amount), { sign: true }), category: t.category?.name ?? null, account: t.accountName })),
          },
          links: [{ label: `Ver ${page.items.length}${page.nextCursor ? "+" : ""} transações`, href: listHref(month, { tipo: type, categoria: categoryId, q }) }],
        };
      }
      case "get_monthly_flow": {
        const { end_month, months } = z.object({ end_month: monthSchema, months: z.number().int().min(2).max(12) }).parse(input);
        const flow = await getMonthlyFlow(tx, userId, end_month, months);
        const avgExpense = flow.reduce((s, f) => s + f.expense, 0n) / BigInt(flow.length);
        return {
          result: { months: flow.map((f) => ({ month: monthLabel(f.month), income: money(f.income), expense: money(f.expense), result: formatBRL(f.result, { sign: true }) })), averageExpense: money(avgExpense) },
          links: [{ label: `Ver ${monthLabel(end_month).toLowerCase()}`, href: listHref(end_month) }],
          chart: flow.map((f) => ({ month: f.month, income: f.income.toString(), expense: f.expense.toString(), result: f.result.toString() })),
        };
      }
      case "get_net_worth": {
        const [nw, balance] = await Promise.all([getNetWorth(tx, userId), getAccountsBalance(tx, userId)]);
        return {
          result: { net: money(nw.net), assets: nw.byClass.map((c) => ({ class: c.class, total: money(c.total) })), liabilities: nw.liabilities.map((l) => ({ name: l.name, value: money(l.value) })), accountsBalance: money(balance.total) },
          links: [{ label: "Ver patrimônio", href: "/patrimonio" }],
        };
      }
      default:
        return { result: { error: `Ferramenta desconhecida: ${name}` }, links: [] };
    }
  });
}

const SYSTEM = (today: ISODate) => `Você é o assistente do Cifra, um app de finanças pessoais brasileiro. Hoje é ${today}; o mês atual é ${today.slice(0, 7)}.
Regras inegociáveis:
- Todo número que você escrever vem de uma ferramenta desta conversa. Nunca calcule, some, estime ou invente valores. Se não há ferramenta que sustente o número, diga que não tem esse dado.
- Chame ferramentas para responder; para médias ou comparações use get_monthly_flow ou compare_periods, que já trazem os números prontos.
- Português do Brasil, direto, segunda pessoa, número antes de adjetivo, sem julgamento, sem elogio, sem emoji. Duas a quatro frases.
- Nunca recomende investimento nem produto financeiro. Conceito pode explicar; conselho, não.
- Você não cria, edita nem apaga nada. Se pedirem, diga que isso se faz nas telas do app.
- Não mencione ferramentas, ids ou SQL. Não repita listas longas: os links para as transações aparecem sob a sua resposta.`;

const MAX_ITERATIONS = 6;

export async function answerQuestion(
  input: { userId: string; question: string; history?: ChatTurn[]; today?: ISODate },
  deps: { model?: ChatModel; modelId?: string } = {},
): Promise<Answer> {
  const model = deps.model ?? new AnthropicChatModel();
  const modelId = deps.modelId ?? MODELS.answer;
  const today = input.today ?? todayISO();
  await assertAiAllowed(input.userId);

  const messages: Anthropic.MessageParam[] = [
    ...(input.history ?? []).slice(-8).map<Anthropic.MessageParam>((t) => ({ role: t.role, content: t.text })),
    { role: "user", content: input.question },
  ];
  const links = new Map<string, AnswerLink>();
  const toolsUsed: string[] = [];
  let chart: Answer["chart"] = null;
  let totalCost = 0;
  let text = "";

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const startedAt = Date.now();
    let response: Anthropic.Message;
    try {
      response = await model.create({
        model: modelId,
        max_tokens: 1500,
        system: SYSTEM(today),
        tools: TOOLS,
        messages,
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
      });
    } catch (e) {
      await logAiUsage({ userId: input.userId, task: "answer", model: modelId, inputTokens: 0, outputTokens: 0, costCents: 0, latencyMs: Date.now() - startedAt, success: false, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
    const cost = costCents(modelId, response.usage.input_tokens, response.usage.output_tokens);
    totalCost += cost;
    await logAiUsage({ userId: input.userId, task: "answer", model: modelId, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, costCents: cost, latencyMs: Date.now() - startedAt, success: true, error: null });

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    text = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();

    if (response.stop_reason === "refusal") {
      text = "Não consigo ajudar com isso.";
      break;
    }
    if (toolUses.length === 0 || response.stop_reason === "end_turn") break;

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of toolUses) {
      toolsUsed.push(call.name);
      try {
        const outcome = await executeTool(input.userId, call.name, call.input);
        for (const l of outcome.links) links.set(l.href, l);
        if (outcome.chart) chart = outcome.chart;
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(outcome.result) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: call.id, content: `Erro: ${e instanceof Error ? e.message : "falha"}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }

  if (!text) text = "Não tenho esse dado.";
  return { text, links: Array.from(links.values()), chart, costCents: totalCost, toolsUsed };
}

export const ASSISTANT_TOOLS = TOOLS;
export { monthPeriod };
