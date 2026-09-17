-- Camada de banco que o Prisma não expressa: vínculo com auth.users, RLS,
-- invariantes (sinal do valor, transferência, descrição original imutável),
-- saldo derivado por trigger e categorias padrão no signup.

-- ---------------------------------------------------------------------------
-- Shim para o shadow database do Prisma (sem Supabase Auth). No projeto real
-- tudo isto já existe e nada aqui é executado.
-- ---------------------------------------------------------------------------
create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relname = 'users'
  ) then
    create table auth.users (id uuid primary key, email text);
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $fn$
      create function auth.uid() returns uuid
      language sql stable
      as 'select (nullif(current_setting(''request.jwt.claims'', true), '''')::jsonb ->> ''sub'')::uuid'
    $fn$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Perfil ligado à identidade do Supabase Auth. Sem FK entre schemas (o Prisma
-- não introspecta): a remoção do usuário em auth.users apaga o perfil por trigger,
-- e o perfil cascateia para todo o resto.
-- ---------------------------------------------------------------------------
create or replace function public.handle_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.profiles where id = old.id;
  return old;
end;
$$;

revoke execute on function public.handle_deleted_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_deleted_user();

-- ---------------------------------------------------------------------------
-- Categorias padrão (18 raízes: 14 despesa, 4 receita). Idempotente por (usuário, nome, raiz).
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_categories(uid uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
begin
  with defaults(name, icon, color, type, sort_order) as (
    values
      ('Moradia',              'house',           'chart-2', 'EXPENSE', 10),
      ('Alimentação',          'utensils',        'brand',   'EXPENSE', 20),
      ('Transporte',           'car',             'chart-3', 'EXPENSE', 30),
      ('Saúde',                'heart-pulse',     'chart-4', 'EXPENSE', 40),
      ('Educação',             'graduation-cap',  'chart-5', 'EXPENSE', 50),
      ('Lazer',                'ticket',          'chart-4', 'EXPENSE', 60),
      ('Compras',              'shopping-bag',    'chart-3', 'EXPENSE', 70),
      ('Assinaturas',          'repeat',          'chart-2', 'EXPENSE', 80),
      ('Pets',                 'paw-print',       'chart-5', 'EXPENSE', 90),
      ('Impostos e taxas',     'landmark',        'chart-4', 'EXPENSE', 100),
      ('Cuidados pessoais',    'sparkles',        'chart-2', 'EXPENSE', 110),
      ('Presentes e doações',  'gift',            'chart-3', 'EXPENSE', 120),
      ('Viagem',               'plane',           'chart-5', 'EXPENSE', 130),
      ('Outros gastos',        'circle-ellipsis', 'chart-5', 'EXPENSE', 140),
      ('Salário',              'briefcase',       'brand',   'INCOME',  10),
      ('Freelance e serviços', 'laptop',          'chart-2', 'INCOME',  20),
      ('Rendimentos',          'trending-up',     'chart-3', 'INCOME',  30),
      ('Outras receitas',      'circle-plus',     'chart-5', 'INCOME',  40)
  ),
  ins as (
    insert into public.categories (id, user_id, name, icon, color, type, parent_id, is_system, sort_order, created_at, updated_at)
    select gen_random_uuid()::text, uid, d.name, d.icon, d.color, d.type::public.category_type, null, true, d.sort_order, now(), now()
    from defaults d
    where not exists (
      select 1 from public.categories c
      where c.user_id = uid and c.parent_id is null and c.name = d.name
    )
    returning 1
  )
  select count(*) into inserted from ins;
  return inserted;
end;
$$;

revoke execute on function public.seed_default_categories(uuid) from public, anon, authenticated;

-- Signup: cria o perfil e as categorias padrão.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, created_at, updated_at)
  values (new.id, coalesce(new.email, ''), now(), now())
  on conflict (id) do nothing;
  perform public.seed_default_categories(new.id);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Invariantes de transação
-- ---------------------------------------------------------------------------
-- Sinal do valor segue o tipo, do ponto de vista da conta de origem.
alter table public.transactions
  add constraint transactions_amount_sign_check check (
    (type = 'EXPENSE'  and amount < 0) or
    (type = 'INCOME'   and amount > 0) or
    (type = 'TRANSFER' and amount < 0)
  );

-- Transferência exige conta de destino diferente da origem; os outros tipos não têm destino.
alter table public.transactions
  add constraint transactions_transfer_check check (
    (type = 'TRANSFER' and transfer_account_id is not null and transfer_account_id <> account_id) or
    (type <> 'TRANSFER' and transfer_account_id is null)
  );

-- Parcela: número e total andam juntos e o número cabe no total.
alter table public.transactions
  add constraint transactions_installment_check check (
    (installment_no is null and installment_total is null) or
    (installment_no between 1 and installment_total)
  );

-- Descrição original do banco não muda depois de gravada.
create or replace function public.protect_original_desc()
returns trigger
language plpgsql
as $$
begin
  if old.original_desc is not null and new.original_desc is distinct from old.original_desc then
    raise exception 'original_desc é imutável' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger transactions_protect_original_desc
  before update on public.transactions
  for each row execute function public.protect_original_desc();

-- ---------------------------------------------------------------------------
-- Saldo derivado: current_balance = initial_balance + soma das transações efetivas
-- ---------------------------------------------------------------------------
create or replace function public.recalc_account_balance(aid text)
returns void
language sql
as $$
  update public.accounts a
  set current_balance = a.initial_balance
    + coalesce((
        select sum(t.amount) from public.transactions t
        where t.account_id = a.id and t.status in ('CONFIRMED', 'RECONCILED')
      ), 0)
    + coalesce((
        select sum(-t.amount) from public.transactions t
        where t.transfer_account_id = a.id and t.type = 'TRANSFER' and t.status in ('CONFIRMED', 'RECONCILED')
      ), 0)
  where a.id = aid;
$$;

create or replace function public.transactions_recalc_balance()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.recalc_account_balance(old.account_id);
    if old.transfer_account_id is not null then perform public.recalc_account_balance(old.transfer_account_id); end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recalc_account_balance(new.account_id);
    if new.transfer_account_id is not null then perform public.recalc_account_balance(new.transfer_account_id); end if;
  end if;
  return null;
end;
$$;

create trigger transactions_recalc_balance
  after insert or update or delete on public.transactions
  for each row execute function public.transactions_recalc_balance();

-- Mudar o saldo inicial também recalcula.
create or replace function public.accounts_recalc_on_initial()
returns trigger
language plpgsql
as $$
begin
  if new.initial_balance is distinct from old.initial_balance then
    perform public.recalc_account_balance(new.id);
  end if;
  return null;
end;
$$;

create trigger accounts_recalc_on_initial
  after update of initial_balance on public.accounts
  for each row execute function public.accounts_recalc_on_initial();

-- ---------------------------------------------------------------------------
-- RLS: toda tabela com user_id só é visível ao próprio usuário
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
create policy profiles_own on public.profiles
  for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts', 'categories', 'transactions', 'tags', 'transaction_tags', 'attachments',
    'import_batches', 'recurrence_rules', 'goals', 'assets', 'net_worth_snapshots',
    'automation_rules', 'merchant_memory', 'insights', 'ai_usage_logs', 'audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t || '_own', t
    );
  end loop;
end $$;

-- Privilégios: usuário autenticado opera (sob RLS); anônimo não toca em nada.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- Histórico de migrations do Prisma nunca é exposto pela Data API
-- (a tabela não existe no shadow database, por isso a guarda).
do $$
begin
  if to_regclass('public._prisma_migrations') is not null then
    alter table public._prisma_migrations enable row level security;
    revoke all on public._prisma_migrations from authenticated, anon;
  end if;
end $$;
