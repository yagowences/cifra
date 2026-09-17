-- Snapshot mensal também para contas (saldo em dinheiro faz parte do patrimônio).
alter table public.net_worth_snapshots alter column asset_id drop not null;
alter table public.net_worth_snapshots add column account_id text references public.accounts (id) on delete cascade;
alter table public.net_worth_snapshots
  add constraint net_worth_snapshots_subject_check check ((asset_id is null) <> (account_id is null));
create unique index net_worth_snapshots_account_id_date_key on public.net_worth_snapshots (account_id, date) where account_id is not null;
create index net_worth_snapshots_account_id_idx on public.net_worth_snapshots (account_id);
