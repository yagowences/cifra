/**
 * Redige dados pessoais antes de qualquer texto ir ao modelo. Nada disto é
 * necessário para ler data, valor e descrição de um lançamento.
 */

const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
/** 13 a 19 dígitos, com ou sem separadores a cada 4: número completo de cartão. */
const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;
const AGENCY_ACCOUNT = /\b(?:ag(?:[eê]ncia)?|c\/?c|conta)\s*:?\s*\d{3,6}[-.]?\d?\s*(?:,|e|\/|-)?\s*(?:c\/?c|conta)?\s*:?\s*\d{4,12}[-.]?\d?\b/gi;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g;

export type Redaction = { kind: "cpf" | "cnpj" | "cartao" | "conta" | "email" | "telefone"; count: number };

export function redactPII(text: string): { text: string; redactions: Redaction[] } {
  const redactions: Redaction[] = [];
  let out = text;
  const apply = (kind: Redaction["kind"], re: RegExp, token: string) => {
    let count = 0;
    out = out.replace(re, () => {
      count++;
      return token;
    });
    if (count) redactions.push({ kind, count });
  };
  // Ordem importa: cartão antes de telefone, CNPJ antes de CPF.
  apply("cartao", CARD, "[CARTAO]");
  apply("cnpj", CNPJ, "[CNPJ]");
  apply("cpf", CPF, "[CPF]");
  apply("conta", AGENCY_ACCOUNT, "[CONTA]");
  apply("email", EMAIL, "[EMAIL]");
  apply("telefone", PHONE, "[TELEFONE]");
  return { text: out, redactions };
}
