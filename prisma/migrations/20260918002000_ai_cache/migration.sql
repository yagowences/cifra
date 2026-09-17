-- Cache de saída de modelo por hash do conteúdo: reprocessar o mesmo arquivo não gasta token.
create table public.ai_cache (
  key text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  task text not null,
  model text not null,
  output jsonb not null,
  created_at timestamptz not null default now()
);

create index ai_cache_user_id_idx on public.ai_cache (user_id);

alter table public.ai_cache enable row level security;
create policy ai_cache_own on public.ai_cache
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.ai_cache to authenticated;
revoke all on public.ai_cache from anon;
