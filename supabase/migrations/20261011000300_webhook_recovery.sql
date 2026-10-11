begin;
alter table public.messages add column if not exists processed_at timestamptz;
alter table public.messages add column if not exists action_key text;
create unique index if not exists messages_action_key_idx on public.messages(action_key) where action_key is not null;
create table if not exists public.webhook_events (
 event_id text primary key,
 payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','processing','completed','failed')),
 attempts integer not null default 0,
 lease_until timestamptz,
 last_error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon,authenticated;
grant all on public.webhook_events to service_role;
create index if not exists webhook_events_retry_idx on public.webhook_events(status,lease_until);
create or replace function public.bahiano_claim_event(p_event_id text,p_payload jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare current_event public.webhook_events;
begin
 insert into public.webhook_events(event_id,payload) values(p_event_id,p_payload)
 on conflict(event_id) do nothing;
 select * into current_event from public.webhook_events where event_id=p_event_id for update;
 if current_event.status='completed' then return 'completed'; end if;
 if current_event.lease_until>now() then return 'busy'; end if;
 update public.webhook_events set status='processing',attempts=attempts+1,
 lease_until=now()+interval '2 minutes',last_error=null,updated_at=now() where event_id=p_event_id;
 return 'claimed';
end;
$$;
revoke all on function public.bahiano_claim_event(text,jsonb) from public,anon,authenticated;
grant execute on function public.bahiano_claim_event(text,jsonb) to service_role;
commit;
