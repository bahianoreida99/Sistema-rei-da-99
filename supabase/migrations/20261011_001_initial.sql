-- Bahiano da 99 — esquema operacional. Idempotente para novos ambientes.
create extension if not exists pgcrypto;
create table if not exists public.contacts (
 id uuid primary key default gen_random_uuid(), chat_id text not null unique,
 phone text, display_name text, classification text not null default 'unknown'
 check(classification in ('unknown','lead','personal')),
 first_message_at timestamptz not null default now(),
 last_message_at timestamptz not null default now(),
 manual_override boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.leads (
 id uuid primary key default gen_random_uuid(),
 contact_id uuid not null unique references public.contacts(id) on delete cascade,
 display_name text,phone text,email text,
 service text not null default 'desconhecido' check(service in ('uber','documento','desconhecido')),
 issue text,price_cents integer not null default 0 check(price_cents>=0),
 source text not null default 'desconhecida', campaign_code text,
 utm_campaign text,utm_source text,utm_content text,
 stage text not null default 'leads' check(stage in ('leads','leads_campaign','conversando','producao','finalizados','pagos')),
 automation_paused boolean not null default false,
 welcome_sent_at timestamptz, first_reply_at timestamptz,
 documents_complete_at timestamptz,production_started_at timestamptz,
 finished_at timestamptz,delivered_at timestamptz,
 proof_received_at timestamptz,paid_at timestamptz,
 payment_status text not null default 'unpaid' check(payment_status in ('unpaid','proof_received','confirmed')),
 payment_confirmed_by uuid, notes text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.messages (
 id uuid primary key default gen_random_uuid(), lead_id uuid references public.leads(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade,
 waha_id text not null unique,direction text not null check(direction in ('incoming','outgoing')),
 kind text not null default 'text' check(kind in ('text','image','document','video','audio','other')),
 body text,media_mime text,received_at timestamptz not null default now()
);
create table if not exists public.documents (
 id uuid primary key default gen_random_uuid(),lead_id uuid not null references public.leads(id) on delete cascade,
 message_id uuid references public.messages(id) on delete set null,
 kind text not null check(kind in ('cnh_frente','cnh_verso','rg_frente','rg_verso','crlv','selfie','comprovante','outro')),
 storage_path text,mime_type text,original_filename text,
 status text not null default 'received' check(status in ('received','verified','rejected')),
 received_at timestamptz not null default now(),verified_at timestamptz,
 unique(lead_id,kind,message_id)
);
create table if not exists public.lead_activity (
 id uuid primary key default gen_random_uuid(),lead_id uuid not null references public.leads(id) on delete cascade,
 kind text not null,description text,metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create table if not exists public.campaigns (
 id uuid primary key default gen_random_uuid(),code text not null unique,
 name text not null,platform text not null default 'meta',utm_campaign text,created_at timestamptz not null default now()
);
create table if not exists public.business_settings (
 key text primary key,value jsonb not null,updated_at timestamptz not null default now()
);
create index if not exists leads_stage_created_idx on public.leads(stage,created_at desc);
create index if not exists leads_payment_idx on public.leads(payment_status,paid_at desc);
create index if not exists messages_contact_recent_idx on public.messages(contact_id,received_at desc);
create index if not exists documents_lead_idx on public.documents(lead_id);
create index if not exists documents_verified_idx on public.documents(lead_id,kind,status);
create index if not exists activity_lead_idx on public.lead_activity(lead_id,created_at desc);
create index if not exists lead_activity_kind_created_idx on public.lead_activity(kind,created_at desc);
create index if not exists contacts_classification_idx on public.contacts(classification,last_message_at desc);
create or replace function public.is_bahiano_admin()
returns boolean language sql stable security definer set search_path='' as $$
 select lower(coalesce(auth.jwt()->>'email',''))='bahiano.reida99uber@gmail.com';
$$;
revoke all on function public.is_bahiano_admin() from public;
grant execute on function public.is_bahiano_admin() to authenticated;
alter table public.contacts enable row level security;
alter table public.leads enable row level security;
alter table public.messages enable row level security;
alter table public.documents enable row level security;
alter table public.lead_activity enable row level security;
alter table public.campaigns enable row level security;
alter table public.business_settings enable row level security;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='contacts' and policyname='admin contacts') then
 create policy "admin contacts" on public.contacts for all to authenticated using(public.is_bahiano_admin()) with check(public.is_bahiano_admin());end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='leads' and policyname='admin leads') then
 create policy "admin leads" on public.leads for all to authenticated using(public.is_bahiano_admin()) with check(public.is_bahiano_admin());end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='messages' and policyname='admin messages') then
 create policy "admin messages" on public.messages for all to authenticated using(public.is_bahiano_admin()) with check(public.is_bahiano_admin());end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='documents' and policyname='admin documents') then
 create policy "admin documents" on public.documents for all to authenticated using(public.is_bahiano_admin()) with check(public.is_bahiano_admin());end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='lead_activity' and policyname='admin activity') then
 create policy "admin activity" on public.lead_activity for all to authenticated using(public.is_bahiano_admin()) with check(public.is_bahiano_admin());end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='campaigns' and policyname='admin campaigns') then
 create policy "admin campaigns" on public.campaigns for all to authenticated using(public.is_bahiano_admin()) with check(public.is_bahiano_admin());end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='business_settings' and policyname='admin settings') then
 create policy "admin settings" on public.business_settings for all to authenticated using(public.is_bahiano_admin()) with check(public.is_bahiano_admin());end if;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('bahiano-documentos','bahiano-documentos',false,12582912,array['image/jpeg','image/png','image/webp','application/pdf','image/heic'])
on conflict(id) do update set public=false,file_size_limit=12582912;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='bahiano admin document reads') then
  create policy "bahiano admin document reads" on storage.objects for select to authenticated using(bucket_id='bahiano-documentos' and public.is_bahiano_admin());end if;
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='bahiano admin document writes') then
  create policy "bahiano admin document writes" on storage.objects for insert to authenticated with check(bucket_id='bahiano-documentos' and public.is_bahiano_admin());end if;
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='bahiano admin document deletes') then
  create policy "bahiano admin document deletes" on storage.objects for delete to authenticated using(bucket_id='bahiano-documentos' and public.is_bahiano_admin());end if;
end $$;
insert into public.business_settings(key,value) values
 ('commission_uber','{"price_cents":35000,"bahiano_cents":27000,"campaign_cents":8000}'::jsonb),
 ('commission_documento','{"price_cents":15000,"bahiano_cents":null,"campaign_cents":null}'::jsonb),
 ('bot','{"enabled":false,"session":"default","admin_email":"bahiano.reida99uber@gmail.com"}'::jsonb)
on conflict(key) do nothing;
create or replace function public.bahiano_validate_payment_transition()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.stage='pagos' and (new.payment_status<>'confirmed' or new.delivered_at is null or new.paid_at is null) then
   raise exception 'Pagamento confirmado exige entrega realizada e data do pagamento';
 end if;
 if new.payment_status='confirmed' and (new.stage<>'pagos' or new.delivered_at is null) then
   raise exception 'Pagamento confirmado exige etapa Pagos e entrega realizada';
 end if;
 return new;
end;
$$;
drop trigger if exists bahiano_validate_payment_transition on public.leads;
create trigger bahiano_validate_payment_transition before insert or update on public.leads
for each row execute function public.bahiano_validate_payment_transition();
create index if not exists documents_message_fk_idx on public.documents(message_id);
create index if not exists messages_lead_fk_idx on public.messages(lead_id);
