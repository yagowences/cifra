import { FileSearch } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Revisão de importação" };

export default function RevisaoImportacaoPage() {
  return (
    <>
      <PageHeader title="Revisão de importação" />
      <EmptyState
        icon={FileSearch}
        title="Lote não encontrado"
        description="Este lote de importação não existe ou já foi desfeito."
        action={{ href: "/importar", label: "Voltar para importar" }}
      />
    </>
  );
}
