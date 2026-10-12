-- Event history is readable only by the confirmed owner. Credentials remain private.
grant select on public.meta_events to authenticated;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='meta_events' and policyname='owner event history') then
  create policy "owner event history" on public.meta_events for select to authenticated using(public.is_bahiano_admin());
 end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='meta_events') then
  alter publication supabase_realtime add table public.meta_events;
 end if;
end $$;
alter table public.meta_events replica identity full;
