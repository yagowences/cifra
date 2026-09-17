import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Cliente administrativo: conecta como `postgres` e ignora RLS.
 * Uso restrito a migrations, seed, jobs e testes. Código de request usa `forUser`.
 */
export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type UserDb = Prisma.TransactionClient;

/**
 * Executa `fn` numa transação em que o Postgres enxerga o usuário autenticado:
 * `auth.uid()` devolve `userId` e o papel vira `authenticated`, então toda
 * política de RLS vale, inclusive para SQL cru em server/queries.
 */
export async function forUser<T>(userId: string, fn: (tx: UserDb) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("userId inválido");
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });

  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`select set_config('request.jwt.claims', ${claims}, true), set_config('role', 'authenticated', true)`;
      return fn(tx);
    },
    // Confirmar um lote grande ou gerar recorrências passa fácil dos 5 s padrão.
    { maxWait: 10_000, timeout: 60_000 },
  );
}
