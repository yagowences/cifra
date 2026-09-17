import { createHash } from "node:crypto";
import type { ISODate } from "./dates";

/**
 * Normaliza a descrição para comparação: minúsculas, sem acento, sem
 * pontuação, espaços colapsados, sem números soltos de autorização.
 */
export function normalizeDescription(description: string): string {
  return description
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Impressão digital de uma transação: SHA-256 de accountId|competenceDate|amount|normalize(description).
 * Única por usuário no banco (@@unique([userId, fingerprint])): é a barreira contra importação duplicada.
 */
export function fingerprint(input: {
  accountId: string;
  competenceDate: ISODate;
  amount: bigint;
  description: string;
}): string {
  const payload = [input.accountId, input.competenceDate, input.amount.toString(), normalizeDescription(input.description)].join("|");
  return createHash("sha256").update(payload).digest("hex");
}
