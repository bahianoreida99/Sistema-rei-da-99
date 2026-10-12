begin;
create extension if not exists pg_cron;
create or replace function public.bahiano_cleanup_inactive_conversations()
returns bigint language plpgsql security definer set search_path='' as $$
declare removed bigint;
begin
  -- Retain documents, contacts, payments and the demonstration until owner review.
  with inactive as (
    select c.id from public.contacts c
    left join public.leads l on l.contact_id=c.id
    where coalesce(l.source,'') <> 'demonstracao'
      and greatest(c.last_message_at,c.updated_at,coalesce(l.updated_at,c.updated_at)) <= now()-interval '72 hours'
      and not exists (select 1 from public.messages m where m.contact_id=c.id and m.received_at > now()-interval '72 hours')
      and not exists (select 1 from public.lead_activity a where a.lead_id=l.id and a.created_at > now()-interval '72 hours')
    for update of c skip locked
  ), deleted as (
    delete from public.messages m using inactive i where m.contact_id=i.id and m.received_at <= now()-interval '72 hours' returning m.id
  ) select count(*) into removed from deleted;
  return removed;
end;
$$;
revoke all on function public.bahiano_cleanup_inactive_conversations() from public,anon,authenticated;
grant execute on function public.bahiano_cleanup_inactive_conversations() to service_role;
insert into public.business_settings(key,value) values ('conversation_retention','{"hours":72,"enabled":true,"scope":"messages_only","preserve_demonstration":true}'::jsonb)
on conflict(key) do update set value=excluded.value,updated_at=now();
do $$ begin
  if not exists(select 1 from cron.job where jobname='bahiano-inactive-conversations') then
    perform cron.schedule('bahiano-inactive-conversations','7 * * * *','select public.bahiano_cleanup_inactive_conversations();');
  end if;
end $$;
commit;
