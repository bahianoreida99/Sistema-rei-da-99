begin;
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
    delete from public.messages m using inactive i where m.contact_id=i.id and m.received_at <= now()-interval '72 hours' returning m.id,m.waha_id
  ), scrubbed as (
    update public.webhook_events e set payload='{}'::jsonb,last_error=null
    from deleted d where e.event_id=d.waha_id and e.status='completed' returning e.event_id
  ) select count(*) into removed from deleted;
  return removed;
end;
$$;
commit;
