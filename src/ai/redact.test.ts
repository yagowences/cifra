import { describe, expect, it } from "vitest";
import { redactPII } from "./redact";

describe("redactPII", () => {
  it("apaga CPF, CNPJ, cartão completo, conta, e-mail e telefone", () => {
    const { text, redactions } = redactPII(
      "Titular: Yago, CPF 123.456.789-09, cartão 4111 1111 1111 1111, ag 1234 c/c 56789-0, yago@x.com, (62) 99999-1234. Empresa 12.345.678/0001-90.",
    );
    expect(text).not.toMatch(/123\.456|4111|56789|yago@|99999/);
    expect(text).toContain("[CPF]");
    expect(text).toContain("[CARTAO]");
    expect(text).toContain("[CNPJ]");
    expect(redactions.map((r) => r.kind).sort()).toEqual(["cartao", "cnpj", "conta", "cpf", "email", "telefone"]);
  });

  it("preserva o que a extração precisa: data, valor e descrição", () => {
    const { text, redactions } = redactPII("03/09/2026  IFD*IFOOD SAO PAULO  -42,90  saldo 3.284,10  final 1234");
    expect(text).toBe("03/09/2026  IFD*IFOOD SAO PAULO  -42,90  saldo 3.284,10  final 1234");
    expect(redactions).toEqual([]);
  });
});
