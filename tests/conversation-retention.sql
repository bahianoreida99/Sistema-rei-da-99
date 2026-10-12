begin;
do $$
declare c uuid; l uuid; m uuid; d uuid;
begin
 insert into public.contacts(chat_id,last_message_at,updated_at) values('QA-RETENTION-'||gen_random_uuid()||'@c.us',now()-interval '73 hours',now()-interval '73 hours') returning id into c;
 insert into public.leads(contact_id,source,service,stage,price_cents,finished_at,delivered_at,paid_at,payment_status,updated_at) values(c,'whatsapp','uber','pagos',35000,now()-interval '75 hours',now()-interval '74 hours',now()-interval '73 hours','confirmed',now()-interval '73 hours') returning id into l;
 insert into public.messages(contact_id,lead_id,waha_id,direction,body,received_at) values(c,l,gen_random_uuid()::text,'incoming','TESTE',now()-interval '73 hours') returning id into m;
 insert into public.documents(lead_id,message_id,kind,storage_path) values(l,m,'crlv','fixture.png') returning id into d;
 insert into public.webhook_events(event_id,payload,status) select waha_id,' {"body":"TESTE"} '::jsonb,'completed' from public.messages where id=m;
 perform public.bahiano_cleanup_inactive_conversations();
 if exists(select 1 from public.messages where id=m) then raise exception 'Inactive message retained';end if;
 if exists(select 1 from public.webhook_events where payload->>'body'='TESTE') then raise exception 'Conversation payload retained';end if;
 if not exists(select 1 from public.documents where id=d and message_id is null and storage_path='fixture.png') then raise exception 'Document lost';end if;
 if not exists(select 1 from public.leads where id=l and payment_status='confirmed' and price_cents=35000) then raise exception 'Financial history lost';end if;
 insert into public.messages(contact_id,lead_id,waha_id,direction,received_at) values(c,l,gen_random_uuid()::text,'outgoing',now());
 insert into public.messages(contact_id,lead_id,waha_id,direction,received_at) values(c,l,gen_random_uuid()::text,'incoming',now()-interval '74 hours') returning id into m;
 perform public.bahiano_cleanup_inactive_conversations();
 if not exists(select 1 from public.messages where id=m) then raise exception 'Active conversation deleted';end if;
 if has_function_privilege('authenticated','public.bahiano_cleanup_inactive_conversations()','execute') then raise exception 'Browser can delete conversations';end if;
 raise notice 'PASS: inactive conversations removed, recent outgoing activity protects conversation, documents and paid records preserved, browser denied';
end $$;
rollback;
