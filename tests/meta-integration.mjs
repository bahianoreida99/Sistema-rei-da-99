import assert from "node:assert/strict";
import vm from "node:vm";
import { metaIntegration } from "../backend/meta-integration.mjs";
const secret="META-SECRET-DO-NOT-EXPOSE";
const tables={meta_config:[{id:1,pixel_id:"",access_token_cipher:null,enabled:false,website_url:"",test_event_code:""}],meta_events:[],leads:[],contacts:[]};
const sent=[];let graphFailure=false;
async function request(input,init={}) {
 const url=new URL(input);
 if(url.hostname==="graph.facebook.com"){const body=JSON.parse(init.body);sent.push(body);return Response.json(graphFailure?{error:{code:190}}:{events_received:1},{status:graphFailure?400:200});}
 const table=url.pathname.split("/").at(-1);assert.ok(tables[table],table);
 let selected=tables[table].filter(row=>[...url.searchParams].every(([key,value])=>["select","order","limit","offset"].includes(key)||value.startsWith("lte.")||String(row[key])===value.replace(/^eq\./,"")));
 if(init.method==="PATCH"){const body=JSON.parse(init.body);for(const row of selected)Object.assign(row,body);}
 return Response.json(selected);
}
const meta=metaIntegration({env:{SUPABASE_URL:"https://db.example",SUPABASE_SERVICE_ROLE_KEY:"fake",META_CONFIG_ENCRYPTION_KEY:Buffer.alloc(32,7).toString("base64")},request});
const call=(path,body)=>meta.route(new Request("https://api.example/admin/meta/"+path,{method:body?"POST":"GET",...(body?{body:JSON.stringify(body)}:{})}));
assert.equal((await call("config",{pixel_id:"BAD",enabled:true})).status,400);
assert.equal((await call("config",{pixel_id:"123456789",enabled:true})).status,400);
assert.equal((await call("test",{})).status,400);
assert.equal((await call("status?offset=-1")).status,400);
await call("config",{pixel_id:"123456789",token:secret,website_url:"https://site.example",test_event_code:"TEST_CODE",enabled:true});
assert.ok(tables.meta_config[0].access_token_cipher);assert.ok(!tables.meta_config[0].access_token_cipher.includes(secret));
assert.ok(!JSON.stringify(await call("status")).includes(secret));assert.ok(!JSON.stringify(await call("status")).includes("access_token_cipher"));
assert.equal((await call("test",{})).events_received,1);assert.equal(tables.meta_config[0].last_test_ok,true);assert.equal(sent[0].test_event_code,"TEST_CODE");assert.equal(sent[0].data[0].event_name,"MetaConnectionTest");
await call("config",{pixel_id:"123456789",token:"",website_url:"https://site.example",enabled:true});assert.equal(tables.meta_config[0].last_test_ok,true);
const beforeScript=sent.length;const script=await meta.pixelScript();new vm.Script(script);let called=0;vm.runInNewContext(script,{location:{origin:"https://admin.example"},window:{},document:{},crypto:{randomUUID:()=>"id"},URL});assert.equal(called,0);assert.equal(sent.length,beforeScript);
tables.leads.push({id:"lead-id",contact_id:"contact-id",source:"whatsapp",phone:"5515981732994",email:"Person@Example.com"});tables.contacts.push({id:"contact-id",classification:"lead"});
const event={event_id:"purchase:lead-id",lead_id:"lead-id",event_name:"Purchase",event_time:new Date().toISOString(),custom_data:{value:350,currency:"BRL"},status:"pending",attempts:0};tables.meta_events.push(event);
await meta.flush();assert.equal(event.status,"sent");const payload=sent.at(-1);assert.equal(payload.access_token,secret);assert.equal(payload.data[0].event_id,event.event_id);assert.equal(payload.data[0].custom_data.value,350);assert.equal(payload.data[0].user_data.ph[0].length,64);assert.equal(payload.data[0].user_data.em[0].length,64);assert.ok(!JSON.stringify(payload.data).includes("Person@Example.com"));assert.ok(!payload.test_event_code,"Live events must not be sent to Test Events");
const count=sent.length;await meta.flush();assert.equal(sent.length,count,"Sent event must not be resent");
tables.leads[0].source="demonstracao";event.status="pending";await meta.flush();assert.equal(event.status,"ignored");assert.equal(sent.length,count);
tables.leads[0].source="whatsapp";tables.contacts[0].classification="personal";event.status="pending";await meta.flush();assert.equal(event.status,"ignored");assert.equal(sent.length,count);
tables.contacts[0].classification="lead";event.status="pending";event.attempts=4;graphFailure=true;await meta.flush();assert.equal(event.status,"failed");assert.equal(event.attempts,5);assert.ok(!event.last_error.includes(secret));
assert.equal(tables.meta_config[0].last_test_ok,false,"A delivery failure must remove the green connection status");
graphFailure=false;await call("config",{pixel_id:"123456789",token:secret,website_url:"https://site.example",enabled:true});assert.equal(event.status,"pending");assert.equal(tables.meta_config[0].last_test_ok,null);await meta.flush();assert.equal(event.status,"sent");assert.equal(sent.at(-1).data[0].event_id,event.event_id);
console.log("PASS Meta: encrypted token, protected status, validation, real acknowledgment requirement, pixel script domain isolation, hashed identifiers, purchase value, deduplication, demo/personal exclusions, retries and recovery after credential correction. Graph transport simulated.");
