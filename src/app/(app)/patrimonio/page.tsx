import { Landmark } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Patrimônio" };

export default function PatrimonioPage() {
  return (
    <>
      <PageHeader title="Patrimônio" />
      <EmptyState
        icon={Landmark}
        title="Nenhum ativo ou dívida cadastrados"
        description="Cadastre contas, investimentos e dívidas para ver seu patrimônio líquido mês a mês."
      />
    </>
  );
}
