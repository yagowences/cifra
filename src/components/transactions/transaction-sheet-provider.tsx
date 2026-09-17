"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { TransactionListItem } from "@/lib/transactions";
import { TransactionSheet } from "./transaction-sheet";

export type AccountOption = { id: string; name: string; type: string };
export type CategoryOption = { id: string; name: string; type: "INCOME" | "EXPENSE"; icon: string; color: string };

type SheetState = { open: boolean; item: TransactionListItem | null };

type Ctx = {
  openNew: () => void;
  openEdit: (item: TransactionListItem) => void;
  accounts: AccountOption[];
  categories: CategoryOption[];
};

const TransactionSheetContext = createContext<Ctx | null>(null);

/**
 * Um único sheet de lançamento para o app inteiro: o "+" da barra inferior,
 * o botão da tela de transações e o toque numa linha abrem o mesmo formulário.
 */
export function TransactionSheetProvider({
  accounts,
  categories,
  children,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  children: ReactNode;
}) {
  const [state, setState] = useState<SheetState>({ open: false, item: null });

  const openNew = useCallback(() => setState({ open: true, item: null }), []);
  const openEdit = useCallback((item: TransactionListItem) => setState({ open: true, item }), []);
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);

  const value = useMemo(() => ({ openNew, openEdit, accounts, categories }), [openNew, openEdit, accounts, categories]);

  return (
    <TransactionSheetContext.Provider value={value}>
      {children}
      <TransactionSheet
        open={state.open}
        item={state.item}
        accounts={accounts}
        categories={categories}
        onClose={close}
      />
    </TransactionSheetContext.Provider>
  );
}

export function useTransactionSheet() {
  const ctx = useContext(TransactionSheetContext);
  if (!ctx) throw new Error("useTransactionSheet precisa do TransactionSheetProvider");
  return ctx;
}
