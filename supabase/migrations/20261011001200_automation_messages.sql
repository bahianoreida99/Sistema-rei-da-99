begin;
insert into public.business_settings(key,value) values('automation_messages','{}'::jsonb) on conflict(key) do nothing;
commit;
