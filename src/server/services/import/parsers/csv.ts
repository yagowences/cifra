import Papa from "papaparse";
import { isISODate } from "@/lib/dates";
import { parseBRL } from "@/lib/money";
import type { CsvMapping, ParsedRow, ParseResult } from "../types";

export type CsvPreview = {
  delimiter: string;
  header: string[] | null;
  /** Primeiras linhas (sem cabeçalho) para o mapeador de colunas. */
  sample: string[][];
  /** Palpite de mapeamento; null quando não dá para reconhecer as colunas. */
  guess: CsvMapping | null;
};

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const DATE_HEADERS = ["data", "date", "dt", "data lancamento", "data da compra", "data mov"];
const DESC_HEADERS = ["descricao", "description", "historico", "titulo", "memo", "lancamento", "estabelecimento", "detalhes"];
const AMOUNT_HEADERS = ["valor", "amount", "value", "montante", "quantia"];
const CREDIT_HEADERS = ["credito", "credit", "entrada", "entradas"];
const DEBIT_HEADERS = ["debito", "debit", "saida", "saidas"];

const findHeader = (header: string[], names: string[]) => {
  const idx = header.findIndex((h) => names.includes(norm(h)));
  return idx >= 0 ? idx : null;
};

/** "17/09/2026", "2026-09-17", "17-09-26" → ISO, conforme o formato. */
export function parseCsvDate(raw: string, format: CsvMapping["dateFormat"]): string | null {
  const s = raw.trim();
  const m = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/.exec(s);
  if (!m) return null;
  let year: number;
  let month: number;
  let day: number;
  if (format === "YMD") [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if (format === "MDY") [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 100) year += 2000;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isISODate(iso) ? iso : null;
}

const looksLikeDate = (s: string) => /^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}/.test(s.trim());
const looksLikeAmount = (s: string) => parseBRL(s) !== null && /\d/.test(s);

function guessDateFormat(values: string[]): CsvMapping["dateFormat"] {
  for (const v of values) {
    const m = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/.exec(v.trim());
    if (!m) continue;
    if (m[1].length === 4) return "YMD";
    if (Number(m[1]) > 12) return "DMY";
    if (Number(m[2]) > 12) return "MDY";
  }
  return "DMY";
}

/** Inspeciona o CSV: delimitador, cabeçalho, amostra e um palpite de mapeamento. */
export function previewCsv(text: string): CsvPreview {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const delimiter = parsed.meta.delimiter;
  const lines = parsed.data.filter((r) => r.some((c) => c.trim() !== ""));
  if (lines.length === 0) return { delimiter, header: null, sample: [], guess: null };

  const first = lines[0];
  const hasHeader = !first.some(looksLikeDate) && !first.some((c) => looksLikeAmount(c) && /^[\d.,\s-]+$/.test(c));
  const header = hasHeader ? first : null;
  const body = hasHeader ? lines.slice(1) : lines;
  const sample = body.slice(0, 5);

  let guess: CsvMapping | null = null;
  if (header) {
    const date = findHeader(header, DATE_HEADERS);
    const description = findHeader(header, DESC_HEADERS);
    const amount = findHeader(header, AMOUNT_HEADERS);
    const credit = findHeader(header, CREDIT_HEADERS);
    const debit = findHeader(header, DEBIT_HEADERS);
    if (date !== null && description !== null && (amount !== null || (credit !== null && debit !== null))) {
      guess = {
        date,
        description,
        amount,
        credit: amount === null ? credit : null,
        debit: amount === null ? debit : null,
        memo: null,
        dateFormat: guessDateFormat(body.map((r) => r[date] ?? "")),
        hasHeader: true,
        invertSign: false,
      };
    }
  }
  if (!guess && body.length > 0) {
    // Sem cabeçalho reconhecível: primeira coluna com cara de data, última numérica, a mais longa em texto é a descrição.
    const width = Math.max(...body.map((r) => r.length));
    const cols = Array.from({ length: width }, (_, i) => body.map((r) => r[i] ?? ""));
    const date = cols.findIndex((c) => c.filter(Boolean).every(looksLikeDate) && c.some(Boolean));
    const amountCandidates = cols.map((c, i) => ({ i, ok: c.filter(Boolean).every(looksLikeAmount) && c.some(Boolean) })).filter((x) => x.ok && x.i !== date);
    const amount = amountCandidates.length > 0 ? amountCandidates[amountCandidates.length - 1].i : -1;
    const textCols = cols.map((c, i) => ({ i, len: c.join("").length })).filter((x) => x.i !== date && x.i !== amount);
    const description = textCols.sort((a, b) => b.len - a.len)[0]?.i ?? -1;
    if (date >= 0 && amount >= 0 && description >= 0) {
      guess = { date, description, amount, credit: null, debit: null, memo: null, dateFormat: guessDateFormat(cols[date]), hasHeader, invertSign: false };
    }
  }
  return { delimiter, header, sample, guess };
}

/** Aplica um mapeamento de colunas e devolve os lançamentos. */
export function parseCsv(text: string, mapping: CsvMapping): ParseResult {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const lines = parsed.data.filter((r) => r.some((c) => c.trim() !== ""));
  const body = mapping.hasHeader ? lines.slice(1) : lines;
  const rows: ParsedRow[] = [];
  const warnings: string[] = [];

  body.forEach((cells, i) => {
    const lineNo = i + (mapping.hasHeader ? 2 : 1);
    const date = parseCsvDate(cells[mapping.date] ?? "", mapping.dateFormat);
    const description = (cells[mapping.description] ?? "").trim();
    let amount: bigint | null = null;
    if (mapping.amount !== null) {
      amount = parseBRL(cells[mapping.amount] ?? "");
    } else if (mapping.credit !== null && mapping.debit !== null) {
      const credit = parseBRL(cells[mapping.credit] ?? "") ?? 0n;
      const debit = parseBRL(cells[mapping.debit] ?? "") ?? 0n;
      amount = credit - (debit < 0n ? -debit : debit);
    }
    if (!date || amount === null || !description) {
      warnings.push(`Linha ${lineNo} ignorada: data, valor ou descrição não reconhecidos.`);
      return;
    }
    if (mapping.invertSign) amount = -amount;
    rows.push({
      externalId: null,
      date,
      amount: amount.toString(),
      description,
      memo: mapping.memo !== null ? (cells[mapping.memo] ?? "").trim() || null : null,
      balanceAfter: null,
    });
  });

  return { rows, declaredClosingBalance: null, declaredClosingDate: null, warnings };
}
