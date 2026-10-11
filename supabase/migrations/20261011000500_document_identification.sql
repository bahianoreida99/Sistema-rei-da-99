alter table public.documents add column if not exists identification_method text;
alter table public.documents add column if not exists identification_confidence integer check (identification_confidence between 0 and 100);
alter table public.documents add column if not exists identification_note text;
