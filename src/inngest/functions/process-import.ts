import { inngest } from "@/inngest/client";
import { db } from "@/server/db";
import { processImportBatch } from "@/server/services/import";
import { downloadWithServiceRole } from "@/server/storage";

/** Fila: lê o arquivo do storage com a chave de serviço e processa o lote. */
export const processImport = inngest.createFunction(
  { id: "process-import", retries: 2, concurrency: { limit: 5 } },
  { event: "import/batch.created" },
  async ({ event, step }) => {
    const batch = await step.run("load-batch", () => db.importBatch.findUniqueOrThrow({ where: { id: event.data.batchId } }));
    await step.run("process", async () => {
      const bytes = await downloadWithServiceRole(batch.storageKey);
      await processImportBatch(batch.id, bytes);
    });
    return { batchId: batch.id };
  },
);
