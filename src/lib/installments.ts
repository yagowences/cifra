/** "(Parcela 09 de 10)", "Parcela 3 de 12" */
const PARCELA_DE = /\(?\s*parcela\s+(\d{1,3})\s+de\s+(\d{1,3})\s*\)?/i;
/** "LOJA 03/10" no fim da descrição (não confunde com data: exige o total ≥ 2 e número ≤ total). */
const BARRA = /\s(\d{1,2})\/(\d{1,2})\s*$/;

export type ParsedInstallment = { no: number; total: number };

/** Número e total da parcela que o banco escreve na descrição; null quando não é parcelado. */
export function parseInstallment(description: string): ParsedInstallment | null {
  const match = PARCELA_DE.exec(description) ?? BARRA.exec(description);
  if (!match) return null;
  const no = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isInteger(no) || !Number.isInteger(total) || total < 2 || total > 120 || no < 1 || no > total) return null;
  return { no, total };
}

/**
 * A mesma descrição com outro número de parcela, no mesmo formato do banco ("Parcela 09 de 10" →
 * "Parcela 10 de 10"). É como a próxima fatura vai escrever a parcela seguinte.
 */
export function withInstallmentNo(description: string, no: number): string {
  const de = PARCELA_DE.exec(description);
  if (de) {
    const width = de[1].length;
    return description.replace(PARCELA_DE, (whole) => whole.replace(de[1], String(no).padStart(width, "0")));
  }
  const barra = BARRA.exec(description);
  if (barra) return description.replace(BARRA, ` ${String(no).padStart(barra[1].length, "0")}/${barra[2]}`);
  return description;
}
