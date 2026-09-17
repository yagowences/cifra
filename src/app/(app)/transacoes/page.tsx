import { Rows3 } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Transações" };

export default function TransacoesPage() {
  return (
    <>
      <PageHeader title="Transações" />
      <EmptyState
        icon={Rows3}
        title="Nenhuma transação ainda"
        description="Importe um extrato ou lance a primeira transação à mão."
        action={{ href: "/importar", label: "Importar extrato" }}
      />
    </>
  );
}
