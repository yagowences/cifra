-- Nível 3 da categorização: vizinhos mais próximos no histórico do usuário por
-- similaridade de trigramas (pg_trgm). Fica no schema extensions, como o Supabase pede.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- Índice para a busca por similaridade sobre a descrição normalizada em minúsculas.
create index if not exists transactions_description_trgm_idx
  on public.transactions using gin (lower(description) extensions.gin_trgm_ops);
