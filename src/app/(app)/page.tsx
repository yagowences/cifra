import { Rows3 } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Início" };

export default function DashboardPage() {
  const now = new Date();
  const monthYear = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(now);
  const month = new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(now);

  return (
    <>
      <header className="pb-6">
        <p className="text-micro text-ink-secondary uppercase">{monthYear}</p>
        <h1 className="mt-1 text-heading">Início</h1>
      </header>
      <EmptyState
        icon={Rows3}
        title={`Nenhuma transação em ${month}`}
        description="Importe um extrato ou lance a primeira transação para ver quanto entrou, quanto saiu e o que sobrou."
        action={{ href: "/importar", label: "Importar extrato" }}
      />
    </>
  );
}
