create table if not exists public.meta_config (
 id integer primary key check(id=1), pixel_id text not null default '',
 access_token_cipher text, website_url text not null default '',
 enabled boolean not null default false, test_event_code text not null default '',
 last_test_at timestamptz, last_test_ok boolean, updated_at timestamptz not null default now()
);
create table if not exists public.meta_events (
 event_id text primary key, lead_id uuid references public.leads(id) on delete cascade,
 event_name text not null, event_time timestamptz not null default now(),
 custom_data jsonb not null default '{}'::jsonb,
 status text not null default 'pending' check(status in ('pending','sent','failed','ignored')),
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 last_error text, sent_at timestamptz
);
alter table public.meta_config enable row level security;
alter table public.meta_events enable row level security;
revoke all on public.meta_config,public.meta_events from anon,authenticated;
grant all on public.meta_config,public.meta_events to service_role;
create index if not exists meta_events_pending_idx on public.meta_events(status,next_attempt_at);
create index if not exists meta_events_lead_idx on public.meta_events(lead_id);
insert into public.meta_config(id) values(1) on conflict(id) do nothing;
create or replace function public.bahiano_marketing_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare l public.leads; name text; suffix text; details jsonb;
begin
 if tg_table_name='leads' then l:=new;
 else select * into l from public.leads where id=new.lead_id; end if;
 if l.id is null or l.source='demonstracao' or exists(select 1 from public.contacts where id=l.contact_id and classification='personal') then return new; end if;
 if tg_table_name='leads' then
  if tg_op='INSERT' then name:='Lead'; suffix:='lead';
  elsif new.first_reply_at is not null and old.first_reply_at is null then name:='Contact';suffix:='contact';
  elsif new.stage='pagos' and old.stage<>'pagos' and new.payment_status='confirmed' and new.delivered_at is not null then name:='Purchase';suffix:='purchase';
  elsif new.delivered_at is not null and old.delivered_at is null then name:='ServiceDelivered';suffix:='delivered';
  elsif new.stage='finalizados' and old.stage<>'finalizados' then name:='ServiceCompleted';suffix:='finished';
  elsif new.stage='producao' and old.stage<>'producao' then name:='ProductionStarted';suffix:='production';
  else return new; end if;
 else
  if tg_op='INSERT' then name:='DocumentReceived';suffix:='document:'||new.id;
  elsif new.status='verified' and old.status<>'verified' then name:='DocumentVerified';suffix:='verified:'||new.id;
  else return new;end if;
 end if;
 details:=jsonb_build_object('content_name',l.service,'currency','BRL');
 if name='Purchase' then details:=details||jsonb_build_object('value',l.price_cents/100.0);end if;
 insert into public.meta_events(event_id,lead_id,event_name,custom_data)
 values(suffix||':'||l.id,l.id,name,details) on conflict(event_id) do nothing;
 return new;
end $$;
revoke all on function public.bahiano_marketing_event() from public,anon,authenticated;
drop trigger if exists bahiano_meta_leads on public.leads;
create trigger bahiano_meta_leads after insert or update on public.leads for each row execute function public.bahiano_marketing_event();
drop trigger if exists bahiano_meta_documents on public.documents;
create trigger bahiano_meta_documents after insert or update on public.documents for each row execute function public.bahiano_marketing_event();
