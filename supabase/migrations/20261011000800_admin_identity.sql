create table if not exists public.bahiano_admins(user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.bahiano_admins enable row level security;
revoke all on public.bahiano_admins from anon,authenticated;
grant all on public.bahiano_admins to service_role;
insert into public.bahiano_admins(user_id) select id from auth.users where lower(email)='bahiano.reida99uber@gmail.com' and email_confirmed_at is not null on conflict do nothing;
create or replace function public.is_bahiano_admin()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.bahiano_admins a join auth.users u on u.id=a.user_id where a.user_id=auth.uid() and u.email_confirmed_at is not null);
$$;
revoke all on function public.is_bahiano_admin() from public;
grant execute on function public.is_bahiano_admin() to authenticated;
