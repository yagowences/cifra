import { z } from "zod";

export const categorizedSchema = z.object({
  results: z.array(
    z.object({
      /** Índice da transação na lista enviada. */
      index: z.number().int().min(0),
      /** Id de uma categoria existente do usuário, ou null quando nenhuma serve. */
      categoryId: z.string().nullable(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export type Categorized = z.infer<typeof categorizedSchema>;
