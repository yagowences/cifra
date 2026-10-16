import { addMonths, formatShortDate } from "@/lib/dates";
import { parseInstallment } from "@/lib/installments";
import type { ParsedRow } from "./types";

/**
 * Compra parcelada na fatura do cartão. O banco repete a data da compra original em toda parcela:
 * "Parcela 09 de 10" vem datada de 16/12/2025 mesmo caindo na fatura de setembro de 2026. A competência
 * da parcela N é a compra + (N − 1) meses (a mesma regra do parcelamento manual), senão as parcelas
 * antigas distorcem os gráficos dos meses em que não houve gasto. Parcela 1 não muda de data.
 */
export function prepareCardRows(rows: ParsedRow[]): ParsedRow[] {
  return rows.map((row) => {
    if (BigInt(row.amount) >= 0n) return row;
    const parcel = parseInstallment(row.description);
    if (!parcel) return row;
    const date = addMonths(row.date, parcel.no - 1);
    const note = parcel.no > 1 ? `Compra em ${formatShortDate(row.date)} · parcela ${parcel.no} de ${parcel.total}` : `Parcela 1 de ${parcel.total}`;
    return { ...row, date, installmentNo: parcel.no, installmentTotal: parcel.total, memo: row.memo ? `${row.memo} · ${note}` : note };
  });
}
