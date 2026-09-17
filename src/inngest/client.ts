import { EventSchemas, Inngest } from "inngest";

type Events = {
  "import/batch.created": { data: { batchId: string } };
};

export const inngest = new Inngest({ id: "cifra", schemas: new EventSchemas().fromRecord<Events>() });

/** Só há fila quando a chave existe; em dev sem Inngest, o trabalho roda após a resposta. */
export const hasQueue = () => Boolean(process.env.INNGEST_EVENT_KEY);
