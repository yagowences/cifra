export const ACCOUNT_TYPES = [
  { value: "CHECKING", label: "Conta corrente", icon: "landmark" },
  { value: "SAVINGS", label: "Poupança", icon: "piggy-bank" },
  { value: "CREDIT_CARD", label: "Cartão de crédito", icon: "credit-card" },
  { value: "CASH", label: "Dinheiro", icon: "banknote" },
  { value: "INVESTMENT", label: "Investimento", icon: "trending-up" },
  { value: "OTHER", label: "Outra", icon: "wallet" },
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number]["value"];

export const accountTypeLabel = (type: string) => ACCOUNT_TYPES.find((t) => t.value === type)?.label ?? type;
export const accountTypeIcon = (type: string) => ACCOUNT_TYPES.find((t) => t.value === type)?.icon ?? "wallet";

/** Forma de uma conta na fronteira servidor → cliente (centavos como string). */
export type AccountListItem = {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  initialBalance: string;
  currentBalance: string;
  closingDay: number | null;
  dueDay: number | null;
  creditLimit: string | null;
  archived: boolean;
};
