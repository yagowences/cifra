import { Target } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Metas" };

export default function MetasPage() {
  return (
    <>
      <PageHeader title="Metas" />
      <EmptyState
        icon={Target}
        title="Nenhuma meta criada"
        description="Defina um valor e um prazo. O Cifra acompanha o progresso a partir das suas transações."
      />
    </>
  );
}
