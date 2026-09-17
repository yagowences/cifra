-- Advisor do Supabase (function_search_path_mutable): funções de trigger com
-- search_path fixo. Todas já usam nomes qualificados com o schema.
alter function public.protect_original_desc() set search_path = '';
alter function public.recalc_account_balance(text) set search_path = '';
alter function public.transactions_recalc_balance() set search_path = '';
alter function public.accounts_recalc_on_initial() set search_path = '';
