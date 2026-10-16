import { describe, expect, it } from "vitest";
import { parseInstallment, withInstallmentNo } from "./installments";

describe("parseInstallment", () => {
  it("lê 'Parcela NN de MM' como a fatura do Inter escreve", () => {
    expect(parseInstallment("CP PARC SHOPPING INTER (Parcela 09 de 10)")).toEqual({ no: 9, total: 10 });
    expect(parseInstallment("MERCADOLIVRE*MERCADOL (Parcela 01 de 04)")).toEqual({ no: 1, total: 4 });
    expect(parseInstallment("Loja parcela 3 de 12")).toEqual({ no: 3, total: 12 });
  });

  it("lê 'N/M' no fim da descrição", () => {
    expect(parseInstallment("AMERICANAS 03/10")).toEqual({ no: 3, total: 10 });
  });

  it("não confunde compra à vista, 1 de 1 nem número fora da faixa", () => {
    expect(parseInstallment("MERCADO DO ZE")).toBeNull();
    expect(parseInstallment("LOJA (Parcela 1 de 1)")).toBeNull();
    expect(parseInstallment("LOJA (Parcela 5 de 3)")).toBeNull();
    expect(parseInstallment("PIX 12/2026 ALUGUEL ABC")).toBeNull();
  });
});

describe("withInstallmentNo", () => {
  it("troca só o número, preservando a largura do banco", () => {
    expect(withInstallmentNo("CP PARC SHOPPING INTER (Parcela 09 de 10)", 10)).toBe("CP PARC SHOPPING INTER (Parcela 10 de 10)");
    expect(withInstallmentNo("MERCADOLIVRE (Parcela 01 de 04)", 2)).toBe("MERCADOLIVRE (Parcela 02 de 04)");
    expect(withInstallmentNo("Loja parcela 3 de 12", 4)).toBe("Loja parcela 4 de 12");
    expect(withInstallmentNo("AMERICANAS 03/10", 4)).toBe("AMERICANAS 04/10");
  });

  it("o resultado é lido de volta como a parcela pedida", () => {
    expect(parseInstallment(withInstallmentNo("OLEO PLUS (Parcela 01 de 03)", 3))).toEqual({ no: 3, total: 3 });
  });
});
