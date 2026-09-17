import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvDate, previewCsv } from "./csv";

const NUBANK = `Data,Valor,Identificador,Descrição
03/09/2026,-42.90,abc-1,Compra no débito - IFD*IFOOD
10/09/2026,4800.00,abc-2,Transferência recebida pelo Pix - ACME
`;

const SEMICOLON = `data;historico;credito;debito
17/09/2026;PIX RECEBIDO;"1.200,00";
16/09/2026;PADARIA;;"55,00"
`;

describe("previewCsv", () => {
  it("reconhece o layout do Nubank pelo cabeçalho", () => {
    const p = previewCsv(NUBANK);
    expect(p.delimiter).toBe(",");
    expect(p.header).toEqual(["Data", "Valor", "Identificador", "Descrição"]);
    expect(p.guess).toMatchObject({ date: 0, description: 3, amount: 1, dateFormat: "DMY", hasHeader: true });
    expect(p.sample).toHaveLength(2);
  });

  it("reconhece crédito e débito separados com ponto e vírgula", () => {
    const p = previewCsv(SEMICOLON);
    expect(p.delimiter).toBe(";");
    expect(p.guess).toMatchObject({ date: 0, description: 1, amount: null, credit: 2, debit: 3 });
  });

  it("sem cabeçalho, adivinha pelas colunas", () => {
    const p = previewCsv(`2026-09-03,IFOOD,-42.90\n2026-09-10,ACME,4800.00\n`);
    expect(p.header).toBeNull();
    expect(p.guess).toMatchObject({ date: 0, description: 1, amount: 2, dateFormat: "YMD", hasHeader: false });
  });

  it("colunas irreconhecíveis devolvem guess nulo para o mapeador", () => {
    const p = previewCsv(`a,b\nx,y\n`);
    expect(p.guess).toBeNull();
  });
});

describe("parseCsv", () => {
  it("aplica o mapeamento e converte valores brasileiros", () => {
    const p = previewCsv(NUBANK);
    const r = parseCsv(NUBANK, p.guess!);
    expect(r.rows).toEqual([
      { externalId: null, date: "2026-09-03", amount: "-4290", description: "Compra no débito - IFD*IFOOD", memo: null, balanceAfter: null },
      { externalId: null, date: "2026-09-10", amount: "480000", description: "Transferência recebida pelo Pix - ACME", memo: null, balanceAfter: null },
    ]);
    expect(r.warnings).toEqual([]);
  });

  it("crédito/débito viram sinal e linhas quebradas avisam", () => {
    const p = previewCsv(SEMICOLON);
    const r = parseCsv(`${SEMICOLON}xx;;;\n`, p.guess!);
    expect(r.rows.map((x) => x.amount)).toEqual(["120000", "-5500"]);
    expect(r.warnings).toEqual(["Linha 4 ignorada: data, valor ou descrição não reconhecidos."]);
  });

  it("invertSign troca o sinal (fatura de cartão com gastos positivos)", () => {
    const r = parseCsv(`date,title,amount\n2026-09-01,Netflix,55.90\n`, { date: 0, description: 1, amount: 2, credit: null, debit: null, memo: null, dateFormat: "YMD", hasHeader: true, invertSign: true });
    expect(r.rows[0].amount).toBe("-5590");
  });
});

describe("parseCsvDate", () => {
  it("formatos DMY, YMD, MDY e ano curto", () => {
    expect(parseCsvDate("17/09/2026", "DMY")).toBe("2026-09-17");
    expect(parseCsvDate("2026-09-17", "YMD")).toBe("2026-09-17");
    expect(parseCsvDate("09/17/2026", "MDY")).toBe("2026-09-17");
    expect(parseCsvDate("17-09-26", "DMY")).toBe("2026-09-17");
    expect(parseCsvDate("31/02/2026", "DMY")).toBeNull();
    expect(parseCsvDate("setembro", "DMY")).toBeNull();
  });
});
