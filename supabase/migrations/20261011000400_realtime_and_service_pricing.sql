-- Publish only the CRM tables, preserving their existing admin-only RLS.
do $$
declare table_name text;
begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach table_name in array array['contacts','leads','messages','documents','lead_activity','campaigns','business_settings'] loop
    execute format('alter table public.%I replica identity full', table_name);
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=table_name) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;
insert into public.business_settings(key,value) values
 ('commission_uber','{"price_cents":35000,"bahiano_cents":27000,"campaign_cents":8000}'::jsonb),
 ('commission_documento','{"price_cents":15000,"bahiano_cents":10000,"campaign_cents":5000}'::jsonb)
on conflict(key) do update set value=excluded.value,updated_at=now();
