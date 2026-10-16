import { addDays } from "@/lib/dates";
import { normalizeDescription } from "@/lib/fingerprint";
import type { ReviewRow } from "./types";

/**
 * Linhas de extrato que não são receita nem despesa de verdade:
 * - `transfer`: pagamento de fatura. Sai da conta corrente e entra no cartão; é uma transferência entre
 *   as duas contas, não "salário" no cartão nem despesa na corrente;
 * - `refund`: estorno, cashback ou resgate de pontos no cartão. Abate despesa, não é renda.
 */
export type RowKind = "transfer" | "refund";

export type AccountLike = { id: string; type: string; institution: string | null; name: string };

const isCard = (type: string) => type === "CREDIT_CARD";
const isBank = (type: string) => type === "CHECKING" || type === "SAVINGS";

/** Pagamento recebido pelo cartão: "PAGAMENTO ON LINE", "PAGAMENTO RECEBIDO", "PGTO DEBITO CONTA"… */
const CARD_PAYMENT = /\b(pagamento (on ?line|recebido|efetuado|de fatura|fatura|debito)|pgto|pag fatura|debito automatico)\b/;
/** Pagamento de fatura visto da conta corrente. */
const BANK_INVOICE = /\b(pagamento (de )?fatura|pgto fatura|pag fatura|fatura (do )?cartao|fatura cartao|cartao de credito)\b/;
const CARD_REFUND = /\b(resgate|pontos|cashback|estorno|reembolso|devolucao|cancelamento|bonus)\b/;

/**
 * Classifica uma linha pelo tipo da conta do lote e pelo texto. Determinístico, sem IA: o pagamento
 * de fatura e o resgate de pontos têm texto estável nos bancos brasileiros.
 * Num cartão, qualquer crédito que não seja o pagamento é abatimento — cartão não recebe renda.
 */
export function classifyRow(input: { description: string; amount: string; accountType: string }): RowKind | null {
  const desc = normalizeDescription(input.description);
  const amount = BigInt(input.amount);
  if (isCard(input.accountType)) {
    if (amount <= 0n) return null;
    if (CARD_PAYMENT.test(desc)) return "transfer";
    return "refund";
  }
  if (isBank(input.accountType) && amount < 0n && BANK_INVOICE.test(desc)) return "transfer";
  return null;
}

const same = (a: string | null, b: string | null) => Boolean(a && b && normalizeDescription(a) === normalizeDescription(b));

/**
 * Conta do outro lado do pagamento: no cartão, a corrente; na corrente, o cartão. Prefere a mesma
 * instituição; sem ela, só se houver uma única candidata. Senão devolve null e a pessoa escolhe.
 */
export function suggestCounterAccount(batchAccount: AccountLike, accounts: AccountLike[]): string | null {
  const wantCard = !isCard(batchAccount.type);
  const candidates = accounts.filter((a) => a.id !== batchAccount.id && (wantCard ? isCard(a.type) : isBank(a.type)));
  const sameInstitution = candidates.filter((a) => same(a.institution, batchAccount.institution));
  if (sameInstitution.length === 1) return sameInstitution[0].id;
  if (sameInstitution.length === 0 && candidates.length === 1) return candidates[0].id;
  return null;
}

export type ExistingTransfer = { id: string; accountId: string; transferAccountId: string; amountAbs: string; date: string };

/** Quantos dias de diferença entre o débito na corrente e o crédito no cartão ainda contam como o mesmo pagamento. */
export const TRANSFER_MATCH_DAYS = 5;

/**
 * Marca como duplicata a linha de pagamento que já existe como transferência (registrada antes pelo
 * outro extrato). Sem isto, importar corrente e cartão contaria o mesmo pagamento duas vezes.
 */
export function markExistingTransfers(rows: ReviewRow[], existing: ExistingTransfer[], batchAccountId: string): ReviewRow[] {
  const claimed = new Set<string>();
  return rows.map((row) => {
    if (row.kind !== "transfer" || row.status === "duplicate") return row;
    const abs = row.amount.replace("-", "");
    const from = addDays(row.date, -TRANSFER_MATCH_DAYS);
    const to = addDays(row.date, TRANSFER_MATCH_DAYS);
    const hit = existing.find(
      (t) =>
        !claimed.has(t.id) &&
        t.amountAbs === abs &&
        t.date >= from &&
        t.date <= to &&
        (t.accountId === batchAccountId || t.transferAccountId === batchAccountId) &&
        (!row.counterAccountId || t.accountId === row.counterAccountId || t.transferAccountId === row.counterAccountId),
    );
    if (!hit) return row;
    claimed.add(hit.id);
    return { ...row, status: "duplicate" as const, matchId: hit.id, matchReason: "Pagamento já registrado pelo extrato da outra conta" };
  });
}
