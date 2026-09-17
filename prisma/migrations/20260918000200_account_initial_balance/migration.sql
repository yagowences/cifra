-- Conta nova nasce com current_balance = initial_balance (o trigger de recálculo só cobria update).
create or replace function public.accounts_set_initial_balance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.current_balance := new.initial_balance;
  return new;
end;
$$;

create trigger accounts_set_initial_balance
  before insert on public.accounts
  for each row execute function public.accounts_set_initial_balance();

-- Corrige contas já criadas sem lançamentos.
update public.accounts a
set current_balance = a.initial_balance
where not exists (select 1 from public.transactions t where t.account_id = a.id or t.transfer_account_id = a.id);
