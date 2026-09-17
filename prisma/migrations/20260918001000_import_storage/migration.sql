-- Importação: estado "precisa de mapeamento" (CSV sem colunas reconhecidas) e
-- bucket privado de uploads com RLS por pasta do usuário.
alter type public.import_status add value if not exists 'NEEDS_MAPPING';

-- O schema storage só existe no Supabase; no shadow database do Prisma, nada disto roda.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'storage' and c.relname = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('cifra-uploads', 'cifra-uploads', false, 20971520, null)
    on conflict (id) do nothing;

    -- Cada usuário só enxerga e escreve dentro de <user_id>/…
    execute $p$
      create policy "uploads_select_own" on storage.objects for select to authenticated
      using (bucket_id = 'cifra-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text)
    $p$;
    execute $p$
      create policy "uploads_insert_own" on storage.objects for insert to authenticated
      with check (bucket_id = 'cifra-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text)
    $p$;
    execute $p$
      create policy "uploads_update_own" on storage.objects for update to authenticated
      using (bucket_id = 'cifra-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text)
      with check (bucket_id = 'cifra-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text)
    $p$;
    execute $p$
      create policy "uploads_delete_own" on storage.objects for delete to authenticated
      using (bucket_id = 'cifra-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text)
    $p$;
  end if;
end $$;
