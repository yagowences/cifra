import { MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Assistente" };

export default function AssistentePage() {
  return (
    <>
      <PageHeader title="Assistente" />
      <EmptyState
        icon={MessageSquare}
        title="Pergunte sobre suas finanças"
        description="O assistente responde com base nas suas transações, e toda resposta com número leva às transações que a compõem."
      />
    </>
  );
}
