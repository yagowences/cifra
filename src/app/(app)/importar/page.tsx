import { Upload } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Importar" };

export default function ImportarPage() {
  return (
    <>
      <PageHeader title="Importar" />
      <EmptyState
        icon={Upload}
        title="Importe seu primeiro extrato"
        description="OFX, CSV, planilha ou PDF do banco. O Cifra lê os lançamentos e mostra tudo para você conferir antes de salvar."
      />
    </>
  );
}
