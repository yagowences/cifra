import { Receipt } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Comprovante" };

export default function ComprovantePage() {
  return (
    <>
      <PageHeader title="Comprovante" />
      <EmptyState
        icon={Receipt}
        title="Nenhum comprovante lido"
        description="Fotografe um comprovante e o Cifra preenche valor, data e estabelecimento para você conferir."
      />
    </>
  );
}
