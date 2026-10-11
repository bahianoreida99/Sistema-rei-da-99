-- Apply only after inspecting the live schema and migration history.
-- No customer records are deleted or rewritten by this migration.
begin;
create or replace function public.is_bahiano_admin()
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from auth.users u
    where u.id=auth.uid()
      and lower(u.email)='bahiano.reida99uber@gmail.com'
      and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.is_bahiano_admin() from public;
grant execute on function public.is_bahiano_admin() to authenticated;
insert into public.business_settings(key,value) values
  ('document_retention','{"days":90,"automatic_deletion_enabled":false,"requires_owner_review":true}'::jsonb)
on conflict(key) do nothing;
create or replace function public.bahiano_validate_payment_transition()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.stage='pagos' and (new.payment_status<>'confirmed' or new.delivered_at is null or new.finished_at is null or new.paid_at is null) then
   raise exception 'Pagamento exige finalização, entrega e confirmação do recebimento';
 end if;
 if new.payment_status='confirmed' and (new.stage<>'pagos' or new.delivered_at is null or new.finished_at is null or new.paid_at is null) then
   raise exception 'Confirmação de pagamento incompleta';
 end if;
 if tg_op='UPDATE' and old.payment_status='confirmed' and new.payment_status<>'confirmed' then
   raise exception 'Estorno exige fluxo auditado; não altere o recebimento diretamente';
 end if;
 return new;
end;
$$;
commit;
