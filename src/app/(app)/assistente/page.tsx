import { MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import { Chat } from "@/components/assistant/chat";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { aiEnabled } from "@/ai/models";
import { requireUserId } from "@/server/auth";

export const metadata: Metadata = { title: "Assistente" };

export default async function AssistentePage() {
  await requireUserId();
  const enabled = aiEnabled();

  return (
    <>
      <PageHeader title="Assistente" />
      {enabled ? (
        <Chat />
      ) : (
        <EmptyState
          icon={MessageSquare}
          title="Assistente desligado"
          description="Configure a chave de IA no servidor (ver .env.example) para perguntar sobre suas finanças. As respostas usam só os números das suas transações e sempre levam a elas."
        />
      )}
    </>
  );
}
