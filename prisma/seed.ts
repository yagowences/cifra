/**
 * Seed de desenvolvimento: garante perfil e as 18 categorias padrão para todo
 * usuário já existente em auth.users (quem se cadastrou antes do trigger).
 * A lista de categorias vive em public.seed_default_categories (migration).
 *
 * Uso: npx prisma db seed
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const profiles = await db.$executeRaw`
    insert into public.profiles (id, email, created_at, updated_at)
    select u.id, coalesce(u.email, ''), now(), now()
    from auth.users u
    where not exists (select 1 from public.profiles p where p.id = u.id)
  `;

  const rows = await db.$queryRaw<{ id: string; inserted: number }[]>`
    select p.id, public.seed_default_categories(p.id) as inserted from public.profiles p
  `;
  const categories = rows.reduce((sum, r) => sum + r.inserted, 0);

  console.log(`perfis criados: ${profiles} · usuários verificados: ${rows.length} · categorias criadas: ${categories}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
