import { describe, expect, it } from "vitest";
import { classifyRow, markExistingTransfers, suggestCounterAccount, type AccountLike } from "./card-credits";
import type { ReviewRow } from "./types";

const row = (over: Partial<ReviewRow>): ReviewRow => ({
  externalId: null,
  date: "2026-08-11",
  amount: "618655",
  description: "PAGAMENTO ON LINE",
  memo: null,
  balanceAfter: null,
  key: "0:a",
  status: "new",
  matchId: null,
  matchReason: null,
  suggestedCategoryId: null,
  confidence: null,
  ...over,
});

describe("classifyRow", () => {
  it("pagamento recebido pelo cartão é transferência, não receita", () => {
    expect(classifyRow({ description: "PAGAMENTO ON LINE", amount: "618655", accountType: "CREDIT_CARD" })).toBe("transfer");
    expect(classifyRow({ description: "Pagamento recebido", amount: "10000", accountType: "CREDIT_CARD" })).toBe("transfer");
  });

  it("resgate de pontos, cashback e estorno no cartão abatem despesa", () => {
    expect(classifyRow({ description: "RESGATE PONTOS", amount: "6820", accountType: "CREDIT_CARD" })).toBe("refund");
    expect(classifyRow({ description: "ESTORNO COMPRA XYZ", amount: "2500", accountType: "CREDIT_CARD" })).toBe("refund");
  });

  it("qualquer crédito desconhecido no cartão também é abatimento: cartão não recebe renda", () => {
    expect(classifyRow({ description: "CREDITO AJUSTE", amount: "100", accountType: "CREDIT_CARD" })).toBe("refund");
  });

  it("compra no cartão não é classificada", () => {
    expect(classifyRow({ description: "PAGAMENTO LOJA X", amount: "-5000", accountType: "CREDIT_CARD" })).toBeNull();
    expect(classifyRow({ description: "MERCADOLIVRE (Parcela 01 de 04)", amount: "-4999", accountType: "CREDIT_CARD" })).toBeNull();
  });

  it("na corrente, pagar a fatura é transferência; o resto não", () => {
    expect(classifyRow({ description: "PAGAMENTO FATURA CARTAO INTER", amount: "-618655", accountType: "CHECKING" })).toBe("transfer");
    expect(classifyRow({ description: "PGTO FATURA", amount: "-100", accountType: "CHECKING" })).toBe("transfer");
    expect(classifyRow({ description: "PIX MERCADO", amount: "-8000", accountType: "CHECKING" })).toBeNull();
    expect(classifyRow({ description: "SALARIO ACME", amount: "500000", accountType: "CHECKING" })).toBeNull();
  });
});

describe("suggestCounterAccount", () => {
  const card: AccountLike = { id: "card-inter", type: "CREDIT_CARD", institution: "Inter", name: "Inter Cartão" };
  const nuCard: AccountLike = { id: "card-nu", type: "CREDIT_CARD", institution: "Nu Pagamentos", name: "Cartão Nubank" };
  const interBank: AccountLike = { id: "bank-inter", type: "CHECKING", institution: "Inter", name: "Inter Corrente" };
  const nuBank: AccountLike = { id: "bank-nu", type: "CHECKING", institution: "Nu Pagamentos", name: "Nubank" };
  const all = [card, nuCard, interBank, nuBank];

  it("cartão aponta para a corrente da mesma instituição", () => {
    expect(suggestCounterAccount(card, all)).toBe("bank-inter");
    expect(suggestCounterAccount(nuCard, all)).toBe("bank-nu");
  });

  it("corrente aponta para o cartão da mesma instituição", () => {
    expect(suggestCounterAccount(interBank, all)).toBe("card-inter");
  });

  it("sem instituição igual e mais de uma candidata, não chuta", () => {
    expect(suggestCounterAccount({ ...card, institution: "Outro" }, all)).toBeNull();
  });

  it("sem instituição igual mas com uma única candidata, usa ela", () => {
    expect(suggestCounterAccount({ ...card, institution: "Outro" }, [card, interBank])).toBe("bank-inter");
  });
});

describe("markExistingTransfers", () => {
  const existing = [{ id: "t1", accountId: "bank-inter", transferAccountId: "card-inter", amountAbs: "618655", date: "2026-08-10" }];

  it("pagamento do cartão que a corrente já registrou vira duplicata", () => {
    const [out] = markExistingTransfers([row({ kind: "transfer", counterAccountId: "bank-inter" })], existing, "card-inter");
    expect(out.status).toBe("duplicate");
    expect(out.matchId).toBe("t1");
  });

  it("vale no sentido contrário: a corrente vê o que o cartão registrou", () => {
    const [out] = markExistingTransfers([row({ kind: "transfer", amount: "-618655", counterAccountId: "card-inter" })], existing, "bank-inter");
    expect(out.status).toBe("duplicate");
  });

  it("valor diferente, data longe ou par de contas diferente não casam", () => {
    expect(markExistingTransfers([row({ kind: "transfer", amount: "618600" })], existing, "card-inter")[0].status).toBe("new");
    expect(markExistingTransfers([row({ kind: "transfer", date: "2026-08-25" })], existing, "card-inter")[0].status).toBe("new");
    expect(markExistingTransfers([row({ kind: "transfer", counterAccountId: "bank-santander" })], existing, "card-inter")[0].status).toBe("new");
  });

  it("uma transferência existente casa com uma linha só", () => {
    const out = markExistingTransfers([row({ kind: "transfer", key: "0:a" }), row({ kind: "transfer", key: "1:b" })], existing, "card-inter");
    expect(out.map((r) => r.status)).toEqual(["duplicate", "new"]);
  });

  it("linhas que não são pagamento ficam intactas", () => {
    expect(markExistingTransfers([row({ kind: "refund" })], existing, "card-inter")[0].status).toBe("new");
  });
});
