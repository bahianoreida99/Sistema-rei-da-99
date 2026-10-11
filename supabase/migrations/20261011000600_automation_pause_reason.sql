alter table public.leads add column if not exists automation_pause_reason text check (automation_pause_reason in ('manual','production'));
