import type { ParsedRow, ParseResult } from "../types";

/**
 * Parser determinístico de OFX (SGML 1.x e XML 2.x). Não depende de fechamento
 * de tags: lê cada bloco <STMTTRN> por campo. Sem cálculo, só leitura.
 */

/** OFX brasileiro costuma vir em ISO-8859-1; o cabeçalho diz. */
export function decodeOfx(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 512));
  const charset = /CHARSET:\s*([\w-]+)/i.exec(head)?.[1]?.toUpperCase();
  const encodingHeader = /ENCODING:\s*([\w-]+)/i.exec(head)?.[1]?.toUpperCase();
  const xmlEncoding = /encoding="([\w-]+)"/i.exec(head)?.[1]?.toUpperCase();
  const label = xmlEncoding ?? (charset === "1252" ? "windows-1252" : charset) ?? (encodingHeader === "UTF-8" ? "utf-8" : "latin1");
  try {
    return new TextDecoder(label.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

const field = (block: string, tag: string): string | null => {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(block);
  return m ? m[1].trim() : null;
};

/** "20260917120000[-3:BRT]" → "2026-09-17" */
export function ofxDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** "-48.90" | "-48,90" | "1234.5" → centavos com sinal. */
export function ofxAmount(raw: string | null): bigint | null {
  if (!raw) return null;
  const s = raw.trim().replace(",", ".");
  const m = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = BigInt(m[2]) * 100n + BigInt((m[3] ?? "").padEnd(2, "0"));
  return m[1] === "-" ? -cents : cents;
}

export function parseOfx(text: string): ParseResult {
  const warnings: string[] = [];
  const rows: ParsedRow[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);

  blocks.forEach((raw, i) => {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    const date = ofxDate(field(block, "DTPOSTED"));
    const amount = ofxAmount(field(block, "TRNAMT"));
    const name = field(block, "NAME");
    const memo = field(block, "MEMO");
    const description = (name || memo || "").trim();
    if (!date || amount === null || !description) {
      warnings.push(`Lançamento ${i + 1} ignorado: data, valor ou descrição ausente.`);
      return;
    }
    rows.push({
      externalId: field(block, "FITID"),
      date,
      amount: amount.toString(),
      description,
      memo: name && memo && memo !== name ? memo : null,
      balanceAfter: null,
    });
  });

  const ledger = text.split(/<LEDGERBAL>/i)[1] ?? "";
  const declaredClosingBalance = ofxAmount(field(ledger, "BALAMT"));
  const declaredClosingDate = ofxDate(field(ledger, "DTASOF"));

  if (blocks.length === 0) warnings.push("Nenhum lançamento (<STMTTRN>) encontrado no arquivo.");

  return { rows, declaredClosingBalance, declaredClosingDate, warnings };
}
