import { describe, expect, it } from "vitest";
import { decodeOfx, ofxAmount, ofxDate, parseOfx } from "./ofx";

const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKTRANLIST>
<DTSTART>20260901
<DTEND>20260917
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260903000000[-3:BRT]
<TRNAMT>-42.90
<FITID>2026090300001
<NAME>IFD*IFOOD SAO PAULO
<MEMO>Compra no débito
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260910120000
<TRNAMT>4800,00
<FITID>2026091000007
<MEMO>TED RECEBIDA ACME CONSULTORIA
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260911
<TRNAMT>abc
<FITID>bad
<NAME>Quebrado
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>3284.10
<DTASOF>20260917
</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

describe("parseOfx", () => {
  it("lê lançamentos, FITID, memo e saldo declarado", () => {
    const result = parseOfx(SGML);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      externalId: "2026090300001",
      date: "2026-09-03",
      amount: "-4290",
      description: "IFD*IFOOD SAO PAULO",
      memo: "Compra no débito",
      balanceAfter: null,
    });
    expect(result.rows[1].description).toBe("TED RECEBIDA ACME CONSULTORIA");
    expect(result.rows[1].amount).toBe("480000");
    expect(result.declaredClosingBalance).toBe(328410n);
    expect(result.declaredClosingDate).toBe("2026-09-17");
    expect(result.warnings).toEqual(["Lançamento 3 ignorado: data, valor ou descrição ausente."]);
  });

  it("aceita OFX 2.x em XML", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><OFX><STMTTRN><DTPOSTED>20260105</DTPOSTED><TRNAMT>-10.5</TRNAMT><FITID>x1</FITID><NAME>Café</NAME></STMTTRN></OFX>`;
    const result = parseOfx(xml);
    expect(result.rows).toEqual([{ externalId: "x1", date: "2026-01-05", amount: "-1050", description: "Café", memo: null, balanceAfter: null }]);
    expect(result.declaredClosingBalance).toBeNull();
  });

  it("arquivo sem lançamentos avisa", () => {
    expect(parseOfx("<OFX></OFX>").warnings[0]).toMatch(/Nenhum lançamento/);
  });
});

describe("helpers", () => {
  it("datas e valores nos formatos que os bancos usam", () => {
    expect(ofxDate("20260917120000[-3:BRT]")).toBe("2026-09-17");
    expect(ofxDate("2026")).toBeNull();
    expect(ofxAmount("-48.90")).toBe(-4890n);
    expect(ofxAmount("48,9")).toBe(4890n);
    expect(ofxAmount("1234")).toBe(123400n);
    expect(ofxAmount("1.234,56")).toBeNull();
  });

  it("decodifica latin1 pelo cabeçalho CHARSET", () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("CHARSET:1252\n<NAME>Caf"), 0xe9]);
    expect(decodeOfx(bytes)).toContain("Café");
  });
});
