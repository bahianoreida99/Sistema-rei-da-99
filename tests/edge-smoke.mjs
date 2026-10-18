// Deterministic integration simulation. No external network requests or personal data.
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let ts;
try {
  ts = require("typescript");
} catch {
  ts = require("/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript");
}
const source = fs.readFileSync(
  new URL("../supabase/functions/bahiano-api/index.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  },
  reportDiagnostics: true,
});
assert.equal(js.diagnostics?.length || 0, 0);
const tables = {
  webhook_events: [],
  contacts: [],
  leads: [],
  messages: [],
  documents: [],
  lead_activity: [],
  business_settings: [{ key: "bot", value: { enabled: true } },{key:"document_batch",value:{enabled:false}},{key:"automation_media",value:{intro_audio:{path:"intro_audio/test.mp3",mime_type:"audio/mpeg",enabled:true}}}],
};
let i = 0;
const outbound = [];
let handler;
let failSend = false;
let ocrResult = { text: "", confidence: 0, method: "unavailable" };
let authUser = { id: "00000000-0000-4000-8000-000000000001", email: "bahiano.reida99uber@gmail.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
let whatsappState = "SCAN_QR_CODE";
let failLogout = false;
const sessionActions = [];
const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake_server_only",
  SUPABASE_ANON_KEY: "test_public",
  WAHA_BASE_URL: "https://waha.example",
  WAHA_PUBLIC_URL: "https://waha-public.example",
  WAHA_API_KEY: "test_waha",
  BAHIANO_WEBHOOK_TOKEN: "private_token",
  BAHIANO_ADMIN_USER_ID: "00000000-0000-4000-8000-000000000001",
};
const fakeJson = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
function select(table, u) {
  let a = tables[table];
  for (const [name, value] of u.searchParams) {
    if (name === "select" || name === "order" || name === "limit") continue;
    if (value.startsWith("eq."))
      a = a.filter(
        (r) => String(r[name]) === decodeURIComponent(value.slice(3)),
      );
  }
  return a;
}
async function fetchMock(input, init = {}) {
  const u = new URL(input);
  if (u.hostname === "waha.example") {
    if (u.pathname === "/api/sessions/default")
      return fakeJson({ name: "default", status: whatsappState });
    if (u.pathname.startsWith("/api/sessions/default/")) {
      const action = u.pathname.split("/").at(-1);
      sessionActions.push(action);
      if (action === "logout" && failLogout) return fakeJson({}, 503);
      whatsappState = action === "stop" ? "STOPPED" : "STARTING";
      return fakeJson({ name: "default", status: whatsappState });
    }

    if (u.pathname === "/api/sendVoice" || u.pathname === "/api/sendImage") {
      if (failSend) return fakeJson({ error: "unavailable" }, 503);
      const msg = JSON.parse(init.body);
      assert.equal(msg.session, "default");
      assert.ok(msg.file.data.length > 0, "WAHA must receive base64 bytes");
      outbound.push({ ...msg, mediaEndpoint: u.pathname });
      return fakeJson({ id: "media-" + outbound.length });
    }
    if (u.pathname === "/api/sendText") {
      if (failSend) return fakeJson({ error: "unavailable" }, 503);
      const msg = JSON.parse(init.body);
      outbound.push(msg);
      return fakeJson({ id: "sent-" + outbound.length });
    }
    if (u.pathname.includes("/api/files/"))
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    throw Error("Unexpected WAHA path " + u.pathname);
  }
  if (u.hostname !== "example.supabase.co")
    throw Error("Unexpected outbound " + u.origin);
  if (u.pathname === "/auth/v1/user")
    return init.headers?.Authorization === "Bearer good"
      ? fakeJson(authUser)
      : fakeJson({ error: "nope" }, 401);
  if (u.pathname.startsWith("/storage/v1/object/authenticated/bahiano-automacao/")) {
    const audio=u.pathname.endsWith(".mp3");
    return new Response(audio ? new Uint8Array([73,68,51,3,0,0,0,0,0,0,0,1]) :
      new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]),{
        status:200,headers:{"content-type":audio?"audio/mpeg":"image/png"}
      });
  }
  if (u.pathname.startsWith("/storage/v1/object/"))
    return fakeJson({ Key: "test" });
  if (u.pathname === "/rest/v1/rpc/bahiano_claim_event") {
    const b = JSON.parse(init.body);
    let event = tables.webhook_events.find((e) => e.event_id === b.p_event_id);
    if (event?.status === "completed") return fakeJson("completed");
    if (!event) {
      event = { event_id: b.p_event_id, payload: b.p_payload };
      tables.webhook_events.push(event);
    }
    event.status = "processing";
    return fakeJson("claimed");
  }
  const table = u.pathname.split("/").at(-1);
  if (!tables[table]) throw Error("Unknown DB " + table);
  if ((init.method || "GET") === "GET") return fakeJson(select(table, u));
  if (init.method === "POST") {
    const b = JSON.parse(init.body);
    if (b.waha_id && tables[table].some((x) => x.waha_id === b.waha_id))
      return fakeJson({ error: "unique" }, 409);
    if (b.chat_id && tables[table].some((x) => x.chat_id === b.chat_id))
      return fakeJson({ error: "unique" }, 409);
    b.id = b.id || "00000000-0000-4000-8000-" + String(++i).padStart(12, "0");
    if(table==="documents" && !b.received_at)b.received_at=new Date().toISOString();
    tables[table].push(b);
    return fakeJson([b]);
  }
  if (init.method === "PATCH") {
    const b = JSON.parse(init.body);
    const affected = select(table, u);
    for (const x of affected) Object.assign(x, b);
    return fakeJson(affected);
  }
  throw Error("Unexpected method " + init.method);
}
const {
  send: automationSend,
  sendMedia: automationSendMedia,
  sendDocumentProgress: automationSendDocumentProgress,
  checkIdleBatches: testIdleBatch,
  recognizeReportedOrigin: parseOrigin
} = vm.runInNewContext(
  js.outputText + "\n;({send,sendMedia,sendDocumentProgress,checkIdleBatches,recognizeReportedOrigin});",
  {
    BahianoReadDocument: async () => ocrResult,
    BahianoConvertToJpeg: async () => new Uint8Array([255,216,255,1,2,3,255,217]),
    Deno: {
      env: { get: (x) => env[x] },
      serve: (fn) => {
        handler = fn;
      },
    },
    fetch: fetchMock,
    crypto: crypto.webcrypto,
    URL,
    Request,
    Response,
    TextEncoder,
    Uint8Array,
    ArrayBuffer,
    AbortSignal,
    Set,
    console,
    Date,
    Error,
    JSON,
    String,
    Boolean,
    Number,
    RegExp,
    encodeURIComponent,
    decodeURIComponent,
    btoa,
  },
  { timeout: 5000 },
);
const req = (route, body, headers = {}) =>
  handler(
    new Request("https://edge.example/bahiano-api/" + route, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  ).then((r) => r.json());
let r = await req(
  "webhook/waha",
  { event: "message" },
  { "x-bahiano-webhook-token": "wrong" },
);
assert.equal(r.error, "Não autorizado");
const event = (mid, body, extra = {}) => ({
  event: "message",
  session: "default",
  payload: {
    from: "5511999990000@c.us",
    id: mid,
    body,
    notifyName: "Teste Anônimo",
    fromMe: false,
    ...extra,
  },
});
r = await req(
  "webhook/waha",
  event("msg-1", "Olá! Vim pelo site, REF:ABC123, Cadastro Uber, CNH vencida."),
  { "x-bahiano-webhook-token": "private_token" },
);
assert.equal(r.started_documents,true);
assert.equal(tables.leads.length,1);
assert.equal(tables.leads[0].stage,"leads_campaign");
assert.equal(outbound.length,2);
assert.equal(outbound[0].mediaEndpoint,"/api/sendVoice");
assert.match(outbound[1].text,/CNH|CRLV/);
assert.doesNotMatch(outbound[1].text,/\bRG\b/i,'Checklist não deve pedir RG');
r = await req("webhook/waha", event("msg-1", "duplicated"), {
  "x-bahiano-webhook-token": "private_token",
});
assert.equal(r.duplicate, true);
r = await req("webhook/waha", event("msg-2", "Ok, concordo, vou enviar."), {
  "x-bahiano-webhook-token": "private_token",
});
assert.equal(tables.leads[0].stage, "conversando");
const lead = tables.leads[0];
lead.email = "teste@example.test";
for (const kind of [
  "cnh_frente",
  "cnh_verso",
  "crlv",
  "selfie",
])
  tables.documents.push({
    id: "doc-" + kind,
    lead_id: lead.id,
    kind,
    status: "verified",
  });
r = await req(
  "admin/production",
  { lead_id: lead.id },
  { authorization: "Bearer good" },
);
assert.equal(r.ok, true);
assert.equal(lead.stage, "producao");
assert.match(outbound.at(-1).text, /Recebemos todos os seus documentos/);
r = await req(
  "admin/finish",
  { lead_id: lead.id },
  { authorization: "Bearer good" },
);
assert.equal(r.ok, true);
assert.equal(lead.stage, "finalizados");
assert.match(outbound.at(-1).text, /videochamada/);
r = await req(
  "webhook/waha",
  event("msg-3", "Segue comprovante Pix", {
    hasMedia: true,
    media: {
      url: "https://waha-public.example/api/files/proof",
      mimetype: "image/jpeg",
    },
  }),
  { "x-bahiano-webhook-token": "private_token" },
);
assert.equal(lead.payment_status, "proof_received");
assert.equal(lead.stage, "finalizados");
assert.equal(tables.documents.at(-1).kind, "comprovante");
// console.log('PASS: webhook authorization, classified site lead, first-message staging, deduplication, reply moves to Conversando, admin production, admin finalization, paid-proof staged (not paid), private document storage.');

// WAHA NOWEB uses @lid for incoming messages and supplies the phone in
// _data.key.remoteJidAlt. Test the exact shape received in production.
const lidValue = "62170205274145@lid";
const lidChat = "5511999994444@c.us";
const lidBody = (id, body) => ({
  event: "message.any",
  session: "default",
  payload: {
    id, body, from: lidValue, fromMe: false,
    _data: { key: { remoteJid: lidValue, remoteJidAlt: "5511999994444@s.whatsapp.net" } },
  },
});
const lidSentBefore = outbound.length;
r = await req("webhook/waha", lidBody("lid-case-1", "Olá, quero fazer uma conta uber"), { "x-bahiano-webhook-token": "private_token" });
assert.equal(r.started_documents, true);
const resolved = tables.contacts.find(c => c.chat_id === lidChat);
assert.ok(resolved, "LID alternative JID must identify the customer phone");
assert.equal(tables.contacts.some(c => c.chat_id === lidValue), false);
const resolvedLead = tables.leads.find(l => l.contact_id === resolved.id);
assert.equal(resolvedLead.service, "uber");
assert.equal(resolvedLead.stage, "leads");
assert.equal(outbound.length, lidSentBefore + 2);
assert.equal(outbound.at(-2).mediaEndpoint,"/api/sendVoice");
assert.equal(outbound.at(-1).chatId, lidChat);
assert.doesNotMatch(outbound.at(-1).text, /\bRG\b/i);
r = await req("webhook/waha", lidBody("lid-case-2", "Ok, vou enviar os documentos"), { "x-bahiano-webhook-token": "private_token" });
assert.equal(resolvedLead.stage, "conversando");
assert.equal(r.stage, "conversando");
r = await req("webhook/waha", lidBody("lid-case-2", "Ok, vou enviar os documentos"), { "x-bahiano-webhook-token": "private_token" });
assert.equal(r.duplicate, true);
console.log("PASS: real WAHA @lid payload resolves to sender phone, sends welcome and advances to Conversando.");

// Greeting from a new WhatsApp contact creates a Kanban card immediately.
// Manually marked personal contacts remain excluded.
const hookHeaders = { "x-bahiano-webhook-token": "private_token" };
let count = tables.leads.length;
r = await req(
  "webhook/waha",
  {
    ...event("unknown-1", "Oi, bom dia"),
    payload: {
      ...event("unknown-1", "Oi, bom dia").payload,
      from: "5511999990001@c.us",
    },
  },
  hookHeaders,
);
assert.equal(r.generic_greeting, true);
assert.equal(tables.leads.length, count + 1);
const greetingLead = tables.leads.at(-1);
assert.equal(greetingLead.service, "desconhecido");
assert.equal(greetingLead.stage, "leads");
assert.ok(greetingLead.welcome_sent_at);
assert.equal(tables.messages.at(-2).lead_id, greetingLead.id);
// Test: generic first messages must be visible as Leads; verified site/Meta ads
// attribution must route to Leads campanha (not merely WAHA source:"app").
const routedMessage=(id,from,body,extra={})=>({
  ...event(id,body),
  payload:{...event(id,body).payload,from,...extra}
});
const leadForChat=(chat)=>tables.leads.find(lead=>
  tables.contacts.some(contact=>contact.id===lead.contact_id && contact.chat_id===chat));
let priorOut=outbound.length;
const neutralChat="5511999991021@c.us";
r=await req("webhook/waha",routedMessage("neutral-first",neutralChat,"Posso falar com alguém?"),hookHeaders);
assert.equal(r.generic_greeting,true);
assert.equal(leadForChat(neutralChat).stage,"leads");
assert.equal(leadForChat(neutralChat).source,"whatsapp");
assert.equal(outbound.length,priorOut+1);
assert.equal(outbound.at(-1).text,"Opa! Tudo bem? como posso ajudar?");
// An off-topic answer is not a commercial lead and never gets another bot reply.
const handoffBefore=outbound.length;
const unrelated=await req("webhook/waha",routedMessage("neutral-followup",neutralChat,"Quero saber do futebol"),hookHeaders);
assert.equal(unrelated.manual_handoff,true);
assert.equal(outbound.length,handoffBefore);
const manualLead=leadForChat(neutralChat);
assert.equal(manualLead.automation_paused,true);
assert.equal(manualLead.conversation_context.handoff_reason,"out_of_scope");
assert.ok(manualLead.conversation_context.kanban_archived_at);
await req("webhook/waha",routedMessage("neutral-after-handoff",neutralChat,"Quero cadastro Uber"),hookHeaders);
assert.equal(outbound.length,handoffBefore,"handoff permanently silences the bot");
assert.equal(manualLead.service,"desconhecido","the manual queue retains the original reason");
assert.ok(tables.messages.some(m=>m.contact_id===manualLead.contact_id&&m.body==="Quero cadastro Uber"),"Baiano retains all messages in human queue");
// New generic request that becomes commercial goes straight to voice + checklist.
const upgradeGenericChat="5511999991028@c.us";
let directBefore=outbound.length;
await req("webhook/waha",routedMessage("upgrade-generic",upgradeGenericChat,"Oi"),hookHeaders);
assert.equal(outbound.at(-1).text,"Opa! Tudo bem? como posso ajudar?");
await req("webhook/waha",routedMessage("upgrade-service",upgradeGenericChat,"Quero fazer uma conta"),hookHeaders);
assert.equal(leadForChat(upgradeGenericChat).service,"uber");
assert.equal(outbound.length,directBefore+3);
assert.equal(outbound.at(-2).mediaEndpoint,"/api/sendVoice");
assert.match(outbound.at(-1).text,/CNH|CRLV/);
assert.equal(leadForChat(upgradeGenericChat).conversation_state,"collecting_documents");
const afterIntro=outbound.length;
await req("webhook/waha",routedMessage("upgrade-continue",upgradeGenericChat,"Meu email é teste@example.com"),hookHeaders);
assert.equal(outbound.length,afterIntro+1,"documents progress must not resend introductory audio");
assert.match(outbound.at(-1).text,/faltam/i);
const siteChat="5511999991022@c.us";
r=await req("webhook/waha",routedMessage("site-first",siteChat,"Oi, vim pelo site"),hookHeaders);
assert.equal(leadForChat(siteChat).stage,"leads_campaign");
assert.equal(leadForChat(siteChat).source,"site");
const metaChat="5511999991023@c.us";
r=await req("webhook/waha",routedMessage("meta-first",metaChat,"Oi",{
  source:"app",referral:{source_type:"ad",source_id:"ad-marker"}
}),hookHeaders);
assert.equal(leadForChat(metaChat).stage,"leads_campaign");
assert.equal(leadForChat(metaChat).source,"site");
const plainAppChat="5511999991024@c.us";
await req("webhook/waha",routedMessage("app-first",plainAppChat,"Oi",{source:"app"}),hookHeaders);
assert.equal(leadForChat(plainAppChat).stage,"leads","WAHA app isn't a marketing source");

const recentChat="5511999991025@c.us";
const recentId="00000000-0000-4000-8000-000000000825";
tables.contacts.push({
  id:recentId,chat_id:recentChat,phone:recentChat.split("@")[0],
  classification:"unknown",manual_override:false,
  display_name:"Cliente conhecido",last_message_at:new Date().toISOString()
});
priorOut=outbound.length;
r=await req("webhook/waha",routedMessage("recent-hello",recentChat,"Olá"),hookHeaders);
assert.equal(r.quiet_recent_contact,true);
assert.equal(leadForChat(recentChat).stage,"leads");
assert.equal(outbound.length,priorOut,"recent contact gets no generic repeat greeting");
r=await req("webhook/waha",routedMessage("recent-uber",recentChat,"Minha conta Uber está bloqueada"),hookHeaders);
assert.equal(leadForChat(recentChat).service,"uber");
assert.equal(outbound.length,priorOut+2,"Uber inquiry starts audio and checklist");

const oldChat="5511999991026@c.us";
tables.contacts.push({
  id:"00000000-0000-4000-8000-000000000826",chat_id:oldChat,phone:oldChat.split("@")[0],
  classification:"unknown",manual_override:false,
  last_message_at:new Date(Date.now()-11*24*3600*1000).toISOString()
});
priorOut=outbound.length;
r=await req("webhook/waha",routedMessage("old-hello",oldChat,"Oi"),hookHeaders);
assert.equal(r.generic_greeting,true);
assert.equal(outbound.length,priorOut+1,"11-day-old contact may receive greeting again");

const upgradeChat="5511999991027@c.us";
await req("webhook/waha",routedMessage("upgrade-initial",upgradeChat,"Oi"),hookHeaders);
assert.equal(leadForChat(upgradeChat).stage,"leads");
r=await req("webhook/waha",routedMessage("upgrade-ad",upgradeChat,"Encontrei vocês no anúncio da Meta Ads"),hookHeaders);
assert.equal(leadForChat(upgradeChat).source,"site");
assert.equal(leadForChat(upgradeChat).stage,"leads_campaign","campaign is attributed before commercial service is identified");
console.log("PASS: first-contact routing, WAHA app ignored as source, Meta referral, site attribution, 10-day generic silence and Uber exception.");

// Retesting from the same number after an administrator reset must ignore
// only the pre-reset 10-day suppression and use fresh media action keys.
const resetChat="5511999912340@c.us";
const resetContact={
 id:"00000000-0000-4000-8000-000000001234",chat_id:resetChat,
 phone:resetChat.split("@")[0],classification:"lead",manual_override:false,
 last_message_at:new Date(Date.now()-3600000).toISOString()
};
const resetDate=new Date().toISOString();
const resetLead={
 id:"00000000-0000-4000-8000-000000001235",
 contact_id:resetContact.id,source:"whatsapp",stage:"leads",
 service:"desconhecido",conversation_state:"discover_service",price_cents:0,
 conversation_context:{test_reset_at:resetDate,kanban_archived_at:resetDate},
 automation_paused:false,welcome_sent_at:null,first_reply_at:null
};
tables.contacts.push(resetContact);tables.leads.push(resetLead);
const previousResetOut=outbound.length;
const firstReset=await req("webhook/waha",routedMessage("reset-first-hello",resetChat,"Oi"),hookHeaders);
assert.equal(firstReset.generic_greeting,true);
assert.equal(outbound.length,previousResetOut+1);
assert.equal(outbound.at(-1).text,"Opa! Tudo bem? como posso ajudar?");
assert.ok(!resetLead.conversation_context.kanban_archived_at,"New message reopens reset card");
const replyReset=await req("webhook/waha",routedMessage("reset-uber",resetChat,"Quero cadastro Uber"),hookHeaders);
assert.equal(replyReset.started_documents,true);
assert.equal(outbound.length,previousResetOut+3);
assert.equal(outbound.at(-2).mediaEndpoint,"/api/sendVoice");
assert.equal(resetLead.conversation_state,"collecting_documents");
assert.ok(outbound.some(x=>x.mediaEndpoint==="/api/sendVoice"&&x.chatId===resetChat));
console.log("PASS: test reset bypasses stale last-contact timer; same number gets clean greeting, audio and checklist.");


// End-to-end delivery simulation for the new multi-intent reply engine. Uses
// real webhook processing, mock Supabase/WAHA, and 15 independent conversations.
const faqInputs=[
  ["Qual o preço?","R\\$ 350,00"],["Quanto tempo demora?","prazo|previs|estimativa|tempo"],
  ["Achei caro","valor|pagamento|pagar"],["Tem garantia?","aprova|garant|requisitos"],
  ["Quais documentos preciso?","CNH|CRLV"],["É seguro mandar meus dados?","dados|senha|documentos"],
  ["Como anda meu pedido?","etapa|atendimento|análise"],["Aceita Pix?","pagamento|Pix|pagar"],
  ["Minha foto ficou borrada","foto|imagem|arquivo"],["Minha conta Uber está bloqueada?","requisitos|Uber|situação|análise|aprovação|liberação"],
  ["Quero documento falso","n[aã]o|irregular"],["Quanto custa e qual o prazo?","R\\$ 350,00"],
  ["Tá muito caro, mas dá pra pagar depois?","paga|valor|pagamento"],
  ["Minha CNH venceu, dá pra analisar?","Uber|requisitos|aprova|situação|análise|liberação"],
  ["Qual o valor, aceita pix e demora quanto?","R\\$ 350,00"]
];
for(let i=0;i<faqInputs.length;i++){
  const chat="551198876"+String(i).padStart(4,"0")+"@c.us";
  const contact={id:"00000000-0000-4000-8000-"+String(8800+i).padStart(12,"0"),
    chat_id:chat,phone:chat.slice(0,-5),classification:"lead",manual_override:false,
    last_message_at:new Date().toISOString()};
  const lead={id:"00000000-0000-4000-8000-"+String(8900+i).padStart(12,"0"),
    contact_id:contact.id,service:"uber",source:"whatsapp",stage:"conversando",
    conversation_state:"collecting_documents",conversation_context:{intro_onboarding_started_at:new Date().toISOString()},issue:"Cadastro suspenso",
    automation_paused:false,price_cents:35000,welcome_sent_at:new Date().toISOString(),
    first_reply_at:new Date().toISOString()};
  tables.contacts.push(contact);tables.leads.push(lead);
  const start=outbound.length;
  const [customer,expected]=faqInputs[i];
  await req("webhook/waha",routedMessage("contextual-case-"+i,chat,customer),hookHeaders);
  assert.equal(outbound.length,start+1,"one response per incoming message "+customer);
  assert.match(outbound.at(-1).text,new RegExp(expected,"i"),customer);
  assert.doesNotMatch(outbound.at(-1).text,/Qual delas você precisa resolver|Hoje atendemos duas situações/i);
  assert.equal(lead.conversation_state,"collecting_documents","FAQ does not reset document collection");
}
console.log("PASS: 15 real webhook-to-response contextual FAQ, multi-question and safety paths (mocked).");


// Regression for real conversation: "Olá tudo bem?", then "Conta uber,
// estou sem EAR na CNH", then "Conta uber". A known Uber lead must not
// repeatedly offer Uber/CRLV service selection.
const stuckChat="5511999991058@c.us";
const stuckContactId="00000000-0000-4000-8000-000000000858";
const stuckLeadId="00000000-0000-4000-8000-000000000859";
tables.contacts.push({
  id:stuckContactId,chat_id:stuckChat,phone:stuckChat.split("@")[0],
  display_name:"Contato teste",classification:"lead",manual_override:false,
  last_message_at:new Date().toISOString()
});
tables.leads.push({
  id:stuckLeadId,contact_id:stuckContactId,phone:stuckChat.split("@")[0],
  display_name:"Contato teste",service:"uber",source:"whatsapp",stage:"conversando",
  conversation_state:"discover_service",conversation_context:{},issue:null,
  automation_paused:false,welcome_sent_at:new Date().toISOString(),first_reply_at:new Date().toISOString(),
  price_cents:35000
});
let messagesBefore=outbound.length;
r=await req("webhook/waha",routedMessage("stuck-greeting",stuckChat,"Olá tudo bem?"),hookHeaders);
assert.equal(r.quiet_recent_contact,true,"repeat greeting within 10 days must be silent");
assert.equal(outbound.length,messagesBefore);
r=await req("webhook/waha",routedMessage("stuck-issue",stuckChat,"Conta uber, estou sem ear na cnh"),hookHeaders);
assert.equal(r.started_documents,true);
const stuckLead=leadForChat(stuckChat);
assert.equal(stuckLead.issue,"CNH sem EAR");
assert.equal(stuckLead.conversation_state,"collecting_documents");
assert.equal(outbound.length,messagesBefore+2);
assert.equal(outbound.at(-2).mediaEndpoint,"/api/sendVoice");
assert.match(outbound.at(-1).text,/CNH|CRLV/);
assert.doesNotMatch(outbound.at(-1).text,/Qual delas você precisa resolver|Hoje atendemos duas situações|R\$ 150,00/);
r=await req("webhook/waha",routedMessage("stuck-again",stuckChat,"Conta uber"),hookHeaders);
assert.equal(outbound.length,messagesBefore+3);
assert.doesNotMatch(outbound.at(-1).text,/Qual delas você precisa resolver|Hoje atendemos duas situações/);
const knownChat="5511999991059@c.us",knownContactId="00000000-0000-4000-8000-000000000860";
tables.contacts.push({
  id:knownContactId,chat_id:knownChat,phone:knownChat.split("@")[0],
  display_name:"Contato conhecido",classification:"lead",manual_override:false,
  last_message_at:new Date().toISOString()
});
tables.leads.push({
  id:"00000000-0000-4000-8000-000000000861",contact_id:knownContactId,phone:knownChat.split("@")[0],
  service:"uber",source:"whatsapp",stage:"conversando",conversation_state:"discover_service",
  conversation_context:{},issue:null,automation_paused:false,
  welcome_sent_at:new Date().toISOString(),first_reply_at:new Date().toISOString(),price_cents:35000
});
r=await req("webhook/waha",routedMessage("known-uber",knownChat,"Conta uber"),hookHeaders);
assert.equal(r.started_documents,true);
assert.equal(leadForChat(knownChat).conversation_state,"collecting_documents");
assert.match(outbound.at(-1).text,/CNH|CRLV/);
assert.doesNotMatch(outbound.at(-1).text,/Qual delas você precisa resolver|R\$ 150,00/);
console.log("PASS: known Uber case leaves discover_service, remembers EAR issue, does not re-greet/re-list services, keeps legitimate qualification.");


const countBeforePersonal=tables.leads.length;
tables.contacts.push({
  id: "00000000-0000-4000-8000-000000000999",
  chat_id: "5511999990002@c.us",
  classification: "personal",
  manual_override: true,
});
r = await req(
  "webhook/waha",
  {
    ...event("personal-1", "Uber CNH orçamento"),
    payload: {
      ...event("personal-1", "Uber CNH orçamento").payload,
      from: "5511999990002@c.us",
    },
  },
  hookHeaders,
);
assert.equal(tables.leads.length, countBeforePersonal);
// Media and payment text never move a finished client back to Conversando.
lead.first_reply_at = null;
r = await req(
  "webhook/waha",
  event("pay-text", "Paguei, pix feito"),
  hookHeaders,
);
assert.equal(lead.stage, "finalizados");
assert.equal(lead.payment_status, "proof_received");
r = await req(
  "admin/payment",
  { lead_id: lead.id },
  { authorization: "Bearer good" },
);
assert.match(r.error, /entregue/);
assert.notEqual(lead.payment_status, "confirmed");
r = await req(
  "admin/deliver",
  { lead_id: lead.id },
  { authorization: "Bearer wrong" },
);
assert.equal(r.error, "Não autorizado");
r = await req(
  "admin/deliver",
  { lead_id: lead.id },
  { authorization: "Bearer good" },
);
assert.equal(r.ok, true);
assert.ok(lead.delivered_at);
r = await req(
  "admin/payment",
  { lead_id: lead.id },
  { authorization: "Bearer good" },
);
assert.equal(r.ok, true);
assert.equal(lead.stage, "pagos");
assert.equal(lead.payment_status, "confirmed");
r = await req(
  "admin/finish",
  { lead_id: lead.id },
  { authorization: "Bearer good" },
);
assert.equal(r.error, "Não está em Produção");
// Do not infer the content of an unlabelled image.
r = await req(
  "webhook/waha",
  event("unknown-image", "", {
    hasMedia: true,
    media: {
      url: "https://waha.example/api/files/image",
      mimetype: "image/jpeg",
    },
  }),
  hookHeaders,
);
assert.equal(tables.documents.at(-1).kind, "outro");
assert.equal(lead.stage, "pagos");
const filesCount = tables.documents.length;
r = await req(
  "webhook/waha",
  event("ssrf", "CNH frente", {
    hasMedia: true,
    media: { url: "https://evil.example/private", mimetype: "image/jpeg" },
  }),
  hookHeaders,
);
assert.equal(tables.documents.length, filesCount);
await req(
  "webhook/waha",
  event("media-credentials", "CNH frente", {
    hasMedia: true,
    media: {
      url: "https://username:password@waha-public.example/api/files/image",
      mimetype: "image/jpeg",
    },
  }),
  hookHeaders,
);
assert.equal(tables.documents.length, filesCount);
// Rewriting an approved public URL must keep the private host even for a // path.
await req(
  "webhook/waha",
  event("media-double-slash", "CNH frente", {
    hasMedia: true,
    media: {
      url: "https://waha-public.example//evil.example/api/files/image",
      mimetype: "image/jpeg",
    },
  }),
  hookHeaders,
);
assert.equal(tables.documents.length, filesCount + 1);
// Pause and edit routes use the authenticated administrative boundary.
r = await req(
  "admin/pause",
  { lead_id: lead.id, paused: true },
  { authorization: "Bearer good" },
);
assert.equal(r.ok, true);
assert.equal(lead.automation_paused, true);
r = await req(
  "admin/details",
  { lead_id: lead.id, email: "updated@example.test" },
  { authorization: "Bearer good" },
);
assert.equal(r.ok, true);
assert.equal(lead.email, "updated@example.test");
// Commercial direct messages keep their own source and initial stage.
r = await req(
  "webhook/waha",
  {
    ...event("commercial-direct", "Preciso de CNH Uber"),
    payload: {
      ...event("commercial-direct", "Preciso de CNH Uber").payload,
      from: "5511999990003@c.us",
    },
  },
  hookHeaders,
);
const direct = tables.leads.at(-1);
assert.equal(direct.stage, "leads");
assert.equal(direct.source, "whatsapp");
assert.equal(direct.campaign_code, null);
let sentCount = outbound.length;
direct.automation_paused = true;
direct.welcome_sent_at = null;
r = await req(
  "webhook/waha",
  {
    ...event("paused-first", "CNH"),
    payload: {
      ...event("paused-first", "CNH").payload,
      from: "5511999990003@c.us",
    },
  },
  hookHeaders,
);
assert.equal(outbound.length, sentCount);
// Missing documents and absent email block production.
r = await req(
  "admin/production",
  { lead_id: direct.id },
  { authorization: "Bearer good" },
);
assert.match(r.error, /e-mail/);
direct.email = "direct@example.test";
r = await req(
  "admin/production",
  { lead_id: direct.id },
  { authorization: "Bearer good" },
);
assert.ok(r.missing.includes("CNH frente"));
// WAHA failure must keep administrative finalization pending.
for (const kind of ["cnh_frente","cnh_verso","crlv","selfie"]) tables.documents.push({id:crypto.randomUUID(),lead_id:direct.id,kind,status:"verified"});
direct.stage = "producao";
failSend = true;
r = await req(
  "admin/finish",
  { lead_id: direct.id },
  { authorization: "Bearer good" },
);
assert.equal(direct.stage, "producao");
assert.match(r.error, /Falha operacional/);
failSend = false;
const originalSource = direct.source;
direct.source = "demonstracao";
const realSendCount = outbound.length;
r = await req("admin/send", { lead_id: direct.id, text: "Mensagem fictícia para apresentação" }, { authorization: "Bearer good" });
assert.equal(r.ok, true);
assert.equal(outbound.length, realSendCount, "Demo actions must not call WhatsApp");
assert.ok(tables.messages.some((message) => message.lead_id === direct.id && message.body === "Mensagem fictícia para apresentação"));
direct.source = originalSource;
console.log("PASS: demonstration messages stay inside CRM without WhatsApp sends.");
// An inactive bot does not greet real contacts.
tables.business_settings[0].value.enabled = false;
sentCount = outbound.length;
r = await req(
  "webhook/waha",
  {
    ...event("bot-off", "Uber CNH vencida"),
    payload: {
      ...event("bot-off", "Uber CNH vencida").payload,
      from: "5511999990004@c.us",
    },
  },
  hookHeaders,
);
assert.equal(outbound.length, sentCount);
// Test mode must never send to a contact outside its explicit allowlist.
tables.business_settings[0].value = {
  enabled: true,
  test_chat_ids: ["5511999990099@c.us"],
};
const testEvent = (id, from) => ({
  ...event(id, "Preciso de documento do carro"),
  payload: { ...event(id, "Preciso de documento do carro").payload, from },
});
await req("webhook/waha", testEvent("test-scope-denied", "5511999990098@c.us"), hookHeaders);
assert.equal(outbound.length, sentCount);
await req("webhook/waha", testEvent("test-scope-allowed", "5511999990099@c.us"), hookHeaders);
assert.equal(outbound.length, sentCount + 2);
tables.business_settings[0].value = { enabled: false };
console.log("PASS: test-mode automation only sends to its authorized contact.");
console.log(
  "PASS: simulated webhook/authentication, personal and unknown contacts, campaign and direct source, first reply, deduplication, private media, unclassified image, SSRF rejection, missing documents/email, production, finish, proof, delivery before payment, pause, details, bot disabled, WAHA failure. No real messages sent.",
);

// A failed webhook retains the incoming message and can recover on redelivery.
tables.business_settings[0].value.enabled = true;
failSend = true;
const recovery = {
  ...event("recover-1", "Preciso de Uber CNH"),
  payload: {
    ...event("recover-1", "Preciso de Uber CNH").payload,
    from: "5511999990005@c.us",
  },
};
r = await req("webhook/waha", recovery, hookHeaders);
assert.match(r.error, /Falha operacional/);
assert.equal(
  tables.webhook_events.find((e) => e.event_id === "recover-1").status,
  "failed",
);
failSend = false;
r = await req("webhook/waha", recovery, hookHeaders);
assert.equal(r.started_documents, true);
assert.equal(
  tables.messages.filter((m) => m.waha_id === "recover-1").length,
  1,
);
assert.equal(
  tables.webhook_events.find((e) => e.event_id === "recover-1").status,
  "completed",
);
const afterRecovery = outbound.length;
r = await req("webhook/waha", recovery, hookHeaders);
assert.equal(r.duplicate, true);
assert.equal(outbound.length, afterRecovery);
// Outgoing phone messages are recorded; connection events do not create leads.
r = await req(
  "webhook/waha",
  {
    event: "message.any",
    session: "default",
    payload: {
      id: "phone-out",
      fromMe: true,
      to: "5511999990005@c.us",
      body: "Mensagem humana",
    },
  },
  hookHeaders,
);
assert.equal(r.ok, true);
assert.equal(tables.messages.at(-1).direction, "outgoing");
count = tables.leads.length;
r = await req(
  "webhook/waha",
  {
    event: "session.status",
    session: "default",
    payload: { status: "FAILED" },
  },
  hookHeaders,
);
assert.equal(r.ok, true);
assert.equal(tables.leads.length, count);
console.log(
  "PASS: persistent failed webhook recovery, incoming deduplication after retry, outgoing phone message, session failure event.",
);
// Pairing commands must be authenticated, preserve working sessions and fully log out on disconnect.
const whatsappRequest = (action, method = "POST", authorized = true) =>
  handler(
    new Request("https://edge.example/admin/whatsapp/" + action, {
      method,
      headers: authorized ? { authorization: "Bearer good" } : {},
    }),
  );
assert.equal((await whatsappRequest("disconnect", "POST", false)).status, 401);
assert.equal(sessionActions.length, 0);
assert.equal((await whatsappRequest("connect", "GET")).status, 405);
whatsappState = "WORKING";
r = await (await whatsappRequest("connect")).json();
assert.equal(r.connected, true);
assert.equal(sessionActions.length, 0);
whatsappState = "SCAN_QR_CODE";
r = await (await whatsappRequest("connect")).json();
assert.equal(r.status, "SCAN_QR_CODE");
assert.equal(sessionActions.length, 0);
whatsappState = "STARTING";
r = await (await whatsappRequest("connect")).json();
assert.equal(r.status, "STARTING");
assert.equal(sessionActions.length, 0);
whatsappState = "PASSKEY_CONFIRMATION_REQUIRED";
r = await (await whatsappRequest("connect")).json();
assert.equal(r.status, "PASSKEY_CONFIRMATION_REQUIRED");
assert.equal(sessionActions.length, 0);
whatsappState = "WORKING";
r = await (await whatsappRequest("disconnect")).json();
assert.equal(r.connected, false);
assert.equal(r.status, "STOPPED");
assert.deepEqual(sessionActions, ["logout", "stop"]);
sessionActions.length = 0;
whatsappState = "STOPPED";
r = await (await whatsappRequest("connect")).json();
assert.equal(r.status, "STARTING");
assert.deepEqual(sessionActions, ["start"]);
sessionActions.length = 0;
whatsappState = "FAILED";
r = await (await whatsappRequest("connect")).json();
assert.equal(r.status, "STARTING");
assert.deepEqual(sessionActions, ["logout", "restart"]);
sessionActions.length = 0;
failLogout = true;
assert.equal((await whatsappRequest("disconnect")).status, 503);
assert.deepEqual(sessionActions, ["logout"]);
console.log(
  "PASS: protected WhatsApp pairing, method restrictions, no reset of QR/starting/working sessions, manual phone confirmation preserved, start stopped session, clear failed pairing before restart, logout then stop and logout failure.",
);

// Complete journeys for both services, including image content without captions.
tables.business_settings[0].value = { enabled: true };
const documentTexts = {
  cnh_frente: "CARTEIRA NACIONAL DE HABILITACAO FRENTE Nome Registro",
  cnh_verso: "CARTEIRA NACIONAL DE HABILITACAO VERSO Observacoes Registro",
  rg_frente: "CARTEIRA DE IDENTIDADE REGISTRO GERAL FRENTE Nome Filiacao",
  rg_verso: "CARTEIRA DE IDENTIDADE REGISTRO GERAL VERSO Data de expedicao",
  crlv: "CERTIFICADO DE REGISTRO E LICENCIAMENTO CRLV VEICULO RENAVAM PLACA",
};
for (const service of ["uber", "documento"]) {
  const phone = service === "uber" ? "5511999990101@c.us" : "5511999990102@c.us";
  const incoming = (id, text, media = false) => ({ event: "message", session: "default", payload: { from: phone, id: service + "-" + id, body: text, fromMe: false, hasMedia: media, ...(media ? { media: { url: "https://waha.example/api/files/fixture.png", mimetype: "image/png", filename: "arquivo.png" } } : {}) } });
  await req("webhook/waha", incoming("first", service === "uber" ? "Preciso de cadastro Uber" : "Preciso de documento do carro"), hookHeaders);
  const journey = tables.leads.at(-1);
  assert.equal(journey.stage, "leads");assert.ok(journey.welcome_sent_at);
  assert.doesNotMatch(outbound.at(-1).text, /\bRG\b/i, "RG não deve ser pedido nos fluxos Uber/CRLV");
  await req("webhook/waha", incoming("reply", "Concordo. Meu email e teste@example.invalid"), hookHeaders);
  assert.equal(journey.stage, "conversando");assert.equal(journey.email, "teste@example.invalid");
  r=await req("admin/details",{lead_id:journey.id,email:"invalid-email"},{authorization:"Bearer good"});assert.match(r.error,/válido/);assert.equal(journey.email,"teste@example.invalid");
  assert.match(outbound.at(-1).text,/Para continuar|faltam|CNH|CRLV/);
  ocrResult = { text: "Paisagem com arvores e flores sem documento", confidence: 94, method: "image_ocr" };
  await req("webhook/waha", incoming("unknown", "", true), hookHeaders);
  const unknown = tables.documents.at(-1);assert.equal(unknown.kind, "outro");assert.equal(unknown.status, "received");
  assert.match(outbound.at(-1).text, /sem identificação|último arquivo/i);
  unknown.received_at = new Date().toISOString();
  await req("webhook/waha", incoming("identify-unknown", "RG frente"), hookHeaders);
  assert.equal(unknown.kind,"rg_frente");assert.equal(unknown.identification_method,"message_followup");assert.equal(unknown.status,"received");
  await req("admin/document", { lead_id: journey.id, document_id: unknown.id, kind: "outro", status: "rejected" }, { authorization: "Bearer good" });
  const requiredKinds = service === "uber" ? ["cnh_frente","cnh_verso","crlv","selfie"] : ["crlv"];
  for (let index = 0; index < requiredKinds.length; index++) {
    const kind = requiredKinds[index];
    ocrResult = { text: documentTexts[kind] || "", confidence: kind === "selfie" ? 0 : 92, method: "image_ocr" };
    await req("webhook/waha", incoming(kind, kind === "selfie" ? "Selfie" : "", true), hookHeaders);
    const document = tables.documents.at(-1);assert.equal(document.kind, kind);assert.equal(document.status,"received");assert.equal(journey.stage,"conversando", "OCR alone must not release production");
    await req("admin/document", { lead_id: journey.id, document_id: document.id, kind, status: "verified" }, { authorization: "Bearer good" });
    assert.equal(journey.stage, index === requiredKinds.length - 1 ? "producao" : "conversando");
  }
  if(service === "uber") await req("admin/pause",{lead_id:journey.id,paused:true},{authorization:"Bearer good"});
  const revoked=tables.documents.find(document=>document.lead_id===journey.id&&document.kind==="crlv");revoked.status="rejected";
  r=await req("admin/finish",{lead_id:journey.id},{authorization:"Bearer good"});assert.match(r.error,/documentos obrigatórios/);assert.equal(journey.stage,"producao");revoked.status="verified";
  r = await req("admin/finish", { lead_id: journey.id }, { authorization: "Bearer good" });assert.equal(r.ok,true);assert.equal(journey.stage,"finalizados");
  assert.equal(journey.automation_paused,service === "uber","Finalization must preserve manual pause and release production pause");
  const beforeVerbalClaim=journey.payment_status;const beforeProofTimestamp=journey.proof_received_at;
  await req("webhook/waha",incoming("verbal-payment","Paguei, pix feito"),hookHeaders);
  assert.equal(journey.payment_status,beforeVerbalClaim,"Verbal payment claim must not mark an absent receipt as received");assert.equal(journey.proof_received_at,beforeProofTimestamp);
  const invalidProof=incoming("unsupported-proof","paguei",true);invalidProof.payload.media.mimetype="image/gif";
  const beforeInvalidProof=journey.payment_status;
  await req("webhook/waha",invalidProof,hookHeaders);
  assert.equal(journey.payment_status,beforeInvalidProof,"Unsupported attachment must not become a received proof merely from its caption");
  ocrResult = { text: "COMPROVANTE PIX AGENDADO Transferencia pendente Valor R$ 150,00 Recebedor Pessoa Teste", confidence: 93, method: "image_ocr" };
  await req("webhook/waha", incoming("scheduled-proof", "", true), hookHeaders);assert.equal(tables.documents.at(-1).kind,"outro");assert.notEqual(journey.payment_status,"confirmed");
  ocrResult = { text: "COMPROVANTE DE PAGAMENTO PIX Transferencia concluida Valor R$ 150,00 Recebedor Pessoa Teste Transacao TESTE", confidence: 93, method: "image_ocr" };
  const beforeProof = outbound.length;
  await req("webhook/waha", incoming("proof", "", true), hookHeaders);
  assert.equal(tables.documents.at(-1).kind,"comprovante");assert.equal(journey.payment_status,"proof_received");assert.equal(journey.stage,"finalizados");assert.ok(journey.proof_received_at);
  if(service === "uber") assert.equal(outbound.length,beforeProof,"Manual pause must suppress receipt reply");
  else assert.match(outbound.at(-1).text,/continua pendente/);
  r = await req("admin/payment", {lead_id:journey.id}, {authorization:"Bearer good"});assert.match(r.error,/entregue/);
  await req("admin/deliver", {lead_id:journey.id}, {authorization:"Bearer good"});
  const quotedPrice=journey.price_cents;journey.price_cents=quotedPrice+1;r=await req("admin/payment",{lead_id:journey.id},{authorization:"Bearer good"});assert.match(r.error,/valor contratado/);journey.price_cents=quotedPrice;
  await req("admin/payment", {lead_id:journey.id}, {authorization:"Bearer good"});assert.equal(journey.payment_status,"confirmed");assert.equal(journey.stage,"pagos");
  const documentCount = tables.documents.length;
  await req("webhook/waha", incoming("proof", "", true), hookHeaders);assert.equal(tables.documents.length,documentCount);assert.equal(journey.payment_status,"confirmed");
  console.log(`PASS complete ${service} journey: first/reply, unknown file, ${requiredKinds.length} documents, human validation, production, finish, scheduled proof rejected, OCR receipt without caption, delivery, manual payment, replay protection`);
}
// Regression: CNH picture recognised as a document family even at OCR 42%.
tables.business_settings[0].value={enabled:true};
const incidentChat="5511999996677@c.us";
const incident=(id,body,filename)=>({
  event:"message",session:"default",
  payload:{from:incidentChat,id:"incident-"+id,fromMe:false,body,hasMedia:!!filename,
    ...(filename?{media:{url:"https://waha.example/api/files/fixture.png",mimetype:"image/png",filename}}:{})}
});
await req("webhook/waha",incident("welcome","Cadastro Uber"),hookHeaders);
const incidentLead=tables.leads.at(-1);
await req("webhook/waha",incident("reply","Vou enviar os documentos"),hookHeaders);
ocrResult={text:"pouco texto com ruido",confidence:42,method:"image_ocr"};
await req("webhook/waha",incident("image","","CNH 01_09_26.jpg"),hookHeaders);
const pendingCnh=tables.documents.at(-1);
// The mock does not apply Postgres received_at defaults; production does.
pendingCnh.received_at=new Date().toISOString();
assert.equal(pendingCnh.kind,"cnh_sem_lado");
assert.equal(pendingCnh.status,"received");
assert.match(outbound.at(-1).text,/frente.*verso/);
r=await req("admin/document",{lead_id:incidentLead.id,document_id:pendingCnh.id,kind:"cnh_sem_lado",status:"verified"},{authorization:"Bearer good"});
assert.match(r.error,/Identifique/);
assert.notEqual(incidentLead.stage,"producao");
await req("webhook/waha",incident("side","É a frente"),hookHeaders);
assert.equal(pendingCnh.kind,"cnh_frente");
assert.equal(pendingCnh.status,"received");
r=await req("admin/document",{lead_id:incidentLead.id,document_id:pendingCnh.id,kind:"cnh_verso",status:"received"},{authorization:"Bearer good"});
assert.equal(r.ok,true);
assert.equal(pendingCnh.kind,"cnh_verso");
assert.equal(pendingCnh.status,"received");
console.log("PASS: CNH sem lado identificada, cliente informa lado, revisão manual, sem validação automática.");
// Composite CNH must be recognized from two independent OCR regions, not a caption.
const bothChat="5511999996688@c.us";
const bothEvent=(id,body,filename)=>({
  event:"message",session:"default",
  payload:{from:bothChat,id:"both-"+id,fromMe:false,body,hasMedia:!!filename,
    ...(filename?{media:{url:"https://waha.example/api/files/fixture.png",mimetype:"image/png",filename}}:{})}
});
await req("webhook/waha",bothEvent("start","Cadastro Uber"),hookHeaders);
const bothLead=tables.leads.at(-1);
await req("webhook/waha",bothEvent("reply","Vou enviar"),hookHeaders);
ocrResult={
  text:"CARTEIRA NACIONAL DE HABILITACAO CNH DIGITAL",
  confidence:84,method:"image_ocr",
  regions:[
    {area:"image_half_1",confidence:83,text:"CARTEIRA NACIONAL DE HABILITACAO NOME FILIACAO DATA DE NASCIMENTO"},
    {area:"image_half_2",confidence:86,text:"CNH OBSERVACOES CATEGORIA DE HABILITACAO QR CODE CODIGO DE SEGURANCA"},
  ]
};
await req("webhook/waha",bothEvent("image","","CNH DIGITAL.png"),hookHeaders);
const bothDoc=tables.documents.at(-1);
assert.equal(bothDoc.kind,"cnh_completa");
assert.equal(bothDoc.status,"received");
assert.match(outbound.at(-1).text,/frente e verso no mesmo arquivo/);
r=await req("admin/missing",{lead_id:bothLead.id},{authorization:"Bearer good"});
assert.ok(!JSON.stringify(r).includes("CNH frente"),"One combined received file fulfills both intake labels");
assert.ok(!JSON.stringify(r).includes("CNH verso"),"No duplicate sides requested");
r=await req("admin/document",{lead_id:bothLead.id,document_id:bothDoc.id,kind:"cnh_completa",status:"verified"},{authorization:"Bearer good"});
assert.equal(r.ok,true);
assert.equal(bothDoc.status,"verified");
assert.notEqual(bothLead.stage,"producao","Other documents still required");
ocrResult={text:"ruido pouco legivel",confidence:32,method:"image_ocr",regions:[]};
await req("webhook/waha",bothEvent("rescan-file","","CNH digital recente.png"),hookHeaders);
const rescanDoc=tables.documents.at(-1);
assert.equal(rescanDoc.kind,"cnh_sem_lado");
ocrResult={
 text:"CNH DIGITAL",confidence:85,method:"image_ocr",
 regions:[
  {area:"image_half_1",confidence:88,text:"CARTEIRA NACIONAL DE HABILITACAO NOME FILIACAO DATA NASCIMENTO"},
  {area:"image_half_2",confidence:89,text:"OBSERVACOES CATEGORIA HABILITACAO QR CODE CODIGO SEGURANCA"},
 ]
};
r=await req("admin/reanalyze-document",{lead_id:bothLead.id,document_id:rescanDoc.id},{authorization:"Bearer good"});
assert.equal(r.ok,true);
assert.equal(rescanDoc.kind,"cnh_completa","Old upload can be rescanned by admin");
assert.equal(rescanDoc.status,"received","Rescan never verifies documents");
assert.notEqual(bothLead.stage,"producao");
console.log("PASS: composite CNH, two faces in one file, no duplicate intake, manual verification, protected rescan.");

// Regression from the real WhatsApp 2994 incident: confirm "Digital", then
// request ONLY missing documents after every accepted item until complete.
tables.business_settings[0].value = { enabled:true };
const progressChat="5511999996789@c.us";
const progress=(id, body, filename, mime="image/jpeg") => ({
  event:"message",session:"default",payload:{
    from:progressChat,id:"progress-"+id,fromMe:false,
    body,hasMedia:Boolean(filename),
    ...(filename ? {media:{url:"https://waha.example/api/files/fixture.png",mimetype:mime,filename}} : {})
  }
});
const progressCall=async (id,body,filename,mime) =>
  req("webhook/waha",progress(id,body,filename,mime),hookHeaders);
await progressCall("hello","Olá, quero minha conta Uber");
const progressLead=tables.leads.at(-1);
assert.equal(progressLead.service,"uber");
ocrResult={text:"pouco texto devido a foto da CNH",confidence:42,method:"image_ocr"};
await progressCall("cnh","","CNH 01_09_26.jpg");
const progressCnh=tables.documents.at(-1);
progressCnh.received_at=new Date().toISOString(); // DB default in production
assert.equal(progressCnh.kind,"cnh_sem_lado");
assert.match(outbound.at(-1).text,/digital.*frente e verso/i);
assert.match(outbound.at(-1).text,/não precisa reenviar/i);
assert.doesNotMatch(outbound.at(-1).text,/Para continuar, ainda faltam/i,"Do not ask for CRLV/selfie before classifying the uploaded CNH");
const digitalResponsesBefore=outbound.length;
await progressCall("digital","Digital");
assert.equal(outbound.length,digitalResponsesBefore+1,"Digital must receive acknowledgement");
assert.equal(progressCnh.kind,"cnh_completa");
assert.equal(progressCnh.status,"received","Client declaration may not verify");
assert.equal(progressCnh.identification_confidence,0,"Client declaration is not OCR proof");
assert.match(progressCnh.identification_note,/OCR não confirmou/);
assert.match(outbound.at(-1).text,/OK!/);
assert.match(outbound.at(-1).text,/CRLV/);
assert.match(outbound.at(-1).text,/selfie/);
assert.match(outbound.at(-1).text,/E-mail/);
assert.doesNotMatch(outbound.at(-1).text,/• CNH frente|• CNH verso/);
assert.equal(progressLead.stage,"conversando","Documents are not auto-verified");
await progressCall("digital","Digital");
assert.equal(outbound.length,digitalResponsesBefore+1,"Duplicate WhatsApp event sends no duplicate");
ocrResult={text:"CRLV LICENCIAMENTO CERTIFICADO DE REGISTRO VEICULO RENAVAM PLACA",confidence:94,method:"image_ocr"};
await progressCall("crlv","","CRLV.jpg");
const progressCRLV=tables.documents.at(-1);
assert.equal(progressCRLV.kind,"crlv");
assert.match(outbound.at(-1).text,/OK!/);
assert.match(outbound.at(-1).text,/selfie/);
assert.match(outbound.at(-1).text,/E-mail/);
assert.doesNotMatch(outbound.at(-1).text,/• documento do carro \(CRLV\)/);
ocrResult={text:"",confidence:0,method:"image_ocr"};
await progressCall("selfie","","Selfie.jpg");
const progressSelfie=tables.documents.at(-1);
assert.equal(progressSelfie.kind,"selfie");
assert.match(outbound.at(-1).text,/• E-mail/);
assert.doesNotMatch(outbound.at(-1).text,/• selfie|• CNH|• documento do carro/i);
await progressCall("email","cliente.teste@example.invalid");
assert.equal(progressLead.email,"cliente.teste@example.invalid");
assert.match(outbound.at(-1).text,/Recebemos todos os itens solicitados/i);
assert.equal(progressLead.stage,"conversando","Never automatically start production");
assert.notEqual(progressCnh.status,"verified");
const beforeExtraGreeting=outbound.length;
assert.equal((await progressCall("extra","Obrigado")).quiet_recent_contact,true);
assert.equal(outbound.length,beforeExtraGreeting,"Generic thanks must not repeat the review-status reply");
progressSelfie.status="rejected";
await progressCall("rejected","OK");
assert.match(outbound.at(-1).text,/• selfie com fundo branco/);
assert.doesNotMatch(outbound.at(-1).text,/• E-mail|• CNH/);
console.log("PASS: first-to-last document checklist: CNH Digital, CRLV, selfie, email, idempotency, rejection and human review.");

// Regression for multiple uncertain uploads in a real-world test: the bot
// asks about the latest *unidentified* file rather than repeating every
// document requirement. Clarification resolves one item at a time.
const uncertainChat="5511999996877@c.us";
const uncertain = (id,body,filename) => ({
  event:"message",session:"default",payload:{
    from:uncertainChat,id:"uncertain-"+id,fromMe:false,body,
    hasMedia:Boolean(filename),
    ...(filename?{media:{url:"https://waha.example/api/files/fixture.png",
      mimetype:"image/png",filename}}:{})
  }
});
await req("webhook/waha",uncertain("hello","Preciso criar uma conta Uber"),hookHeaders);
ocrResult={text:"fotografia sem leitura clara",confidence:25,method:"image_ocr"};
await req("webhook/waha",uncertain("first-file","","arquivo1.png"),hookHeaders);
const u1=tables.documents.at(-1);u1.received_at=new Date(Date.now()-15000).toISOString();
assert.equal(u1.kind,"outro");
assert.match(outbound.at(-1).text,/último arquivo enviado é CNH, CRLV ou selfie/i);
assert.doesNotMatch(outbound.at(-1).text,/Para continuar, ainda faltam/i);
await req("webhook/waha",uncertain("second-file","","arquivo2.png"),hookHeaders);
const u2=tables.documents.at(-1);u2.received_at=new Date().toISOString();
assert.equal(u2.kind,"outro");
assert.match(outbound.at(-1).text,/2 arquivos recebidos/i);
await req("webhook/waha",uncertain("email","testefile@example.invalid"),hookHeaders);
assert.match(outbound.at(-1).text,/não precisa reenviá-los agora/i);
assert.doesNotMatch(outbound.at(-1).text,/último arquivo enviado é/i,"Do not repeat classification question after email");
await req("webhook/waha",uncertain("identify-latest","o último arquivo é CRLV"),hookHeaders);
assert.equal(u2.kind,"crlv","Latest pending upload is the one clarified");
assert.equal(u1.kind,"outro","Previous unknown file remains unchanged");
assert.match(outbound.at(-1).text,/último arquivo enviado é CNH, CRLV ou selfie/i,
  "After one file is resolved, ask about the other unknown");
await req("webhook/waha",uncertain("identify-previous","selfie"),hookHeaders);
assert.equal(u1.kind,"selfie","Second clarification resolves the remaining upload");
assert.doesNotMatch(outbound.at(-1).text,/sem identificação|último arquivo enviado/i);
assert.match(outbound.at(-1).text,/CNH/,"Only CNH is now outstanding");
const unknownCount=tables.documents.filter(d=>d.lead_id===leadForChat(uncertainChat).id && d.kind==="outro").length;
assert.equal(unknownCount,0);
console.log("PASS: two unidentified files receive one-at-a-time classification, email does not repeat the question, no file is falsely verified.");


const separateChat="5511999996790@c.us";
const separate=(id,body,filename)=>({
  event:"message",session:"default",payload:{from:separateChat,id:"separate-"+id,fromMe:false,body,hasMedia:!!filename,
    ...(filename?{media:{url:"https://waha.example/api/files/fixture.png",mimetype:"image/jpeg",filename}}:{})}
});
await req("webhook/waha",separate("hello","Quero conta Uber"),hookHeaders);
ocrResult={text:"CARTEIRA NACIONAL DE HABILITACAO FRENTE NOME FILIACAO",confidence:96,method:"image_ocr"};
await req("webhook/waha",separate("front","","cnh_frente.jpg"),hookHeaders);
assert.match(outbound.at(-1).text,/• CNH verso/);
assert.doesNotMatch(outbound.at(-1).text,/• CNH frente/);
ocrResult={text:"CARTEIRA NACIONAL DE HABILITACAO VERSO OBSERVACOES REGISTRO",confidence:96,method:"image_ocr"};
await req("webhook/waha",separate("back","","cnh_verso.jpg"),hookHeaders);
assert.doesNotMatch(outbound.at(-1).text,/• CNH frente|• CNH verso/);
assert.match(outbound.at(-1).text,/CRLV/);
console.log("PASS: separated CNH fronts/backs remove only the matching outstanding requirement.");

const carChat="5511999996791@c.us";
const car=(id,body,filename)=>({event:"message",session:"default",
  payload:{from:carChat,id:"car-"+id,fromMe:false,body,hasMedia:!!filename,
    ...(filename?{media:{url:"https://waha.example/api/files/fixture.png",mimetype:"image/jpeg",filename}}:{})}});
await req("webhook/waha",car("hello","Preciso do documento do carro CRLV"),hookHeaders);
const carProgressLead=tables.leads.at(-1);
assert.equal(carProgressLead.service,"documento");
ocrResult={text:"CRLV LICENCIAMENTO CERTIFICADO DE REGISTRO VEICULO RENAVAM PLACA",confidence:94,method:"image_ocr"};
await req("webhook/waha",car("crlv","","CRLV.jpg"),hookHeaders);
assert.match(outbound.at(-1).text,/• E-mail/);
assert.doesNotMatch(outbound.at(-1).text,/• CNH|• documento do carro/);
await req("webhook/waha",car("email","meuemail@example.invalid"),hookHeaders);
assert.match(outbound.at(-1).text,/Recebemos todos os itens solicitados/i);
assert.equal(carProgressLead.stage,"conversando");
console.log("PASS: CRLV-only flow: one document + email, then wait for human verification.");

const unknownChat="5511999996792@c.us";
const unknownEvent=(id,body,filename,mime="image/jpeg")=>({event:"message",session:"default",
  payload:{from:unknownChat,id:"unknown-flow-"+id,fromMe:false,body,hasMedia:!!filename,
    ...(filename?{media:{url:"https://waha.example/api/files/fixture.png",mimetype:mime,filename}}:{})}});
await req("webhook/waha",unknownEvent("start","Quero o documento do carro"),hookHeaders);
ocrResult={text:"ruido ilegivel",confidence:22,method:"image_ocr"};
await req("webhook/waha",unknownEvent("media","","arquivo.jpg"),hookHeaders);
const unknownFile=tables.documents.at(-1);
unknownFile.received_at=new Date().toISOString();
assert.equal(unknownFile.kind,"outro");
assert.match(outbound.at(-1).text,/sem identificação|último arquivo/i);
assert.doesNotMatch(outbound.at(-1).text,/• documento do carro/,"Do not call an unclassified received CRLV missing before asking its type");
await req("webhook/waha",unknownEvent("identify","É o CRLV"),hookHeaders);
assert.equal(unknownFile.kind,"crlv");
assert.equal(unknownFile.status,"received");
assert.match(outbound.at(-1).text,/• E-mail/);
assert.doesNotMatch(outbound.at(-1).text,/• documento do carro/);
const beforeUnsupportedDocs=tables.documents.length;
await req("webhook/waha",unknownEvent("bad","","invalido.gif","image/gif"),hookHeaders);
assert.equal(tables.documents.length,beforeUnsupportedDocs);
assert.match(outbound.at(-1).text,/Não conseguimos registrar/i);
assert.match(outbound.at(-1).text,/• E-mail/);
console.log("PASS: unknown image, type clarification, invalid media and pending-item checklist.");

env.BAHIANO_ADMIN_USER_ID=authUser.id;
const originalAuth={...authUser};
authUser={...authUser,email:"new-owner@example.invalid"};
assert.equal((await whatsappRequest("session", "GET")).status,200,"Owner must retain API access after email change");
authUser={...originalAuth,id:"00000000-0000-4000-8000-000000000099"};
assert.equal((await whatsappRequest("session", "GET")).status,401,"Matching email must not grant another identity access");
authUser={...originalAuth,email_confirmed_at:null};
assert.equal((await whatsappRequest("session", "GET")).status,401,"Unconfirmed identity must be rejected");
authUser=originalAuth;
delete env.BAHIANO_ADMIN_USER_ID;
assert.equal((await whatsappRequest("session","GET")).status,401,"Missing owner configuration must fail closed");
env.BAHIANO_ADMIN_USER_ID=originalAuth.id;
assert.equal((await handler(new Request("https://api.example/admin/meta/status"))).status,401);
console.log("PASS stable owner identity, email change, matching-email impersonation rejection and protected Meta route.");

// Exercise the real template resolver and protected configuration route.
tables.business_settings.push({key:"automation_messages",value:{},updated_at:"2026-10-11T00:00:00.000Z"});
const readAutomation = () => handler(new Request("https://api.example/admin/automation",{headers:{authorization:"Bearer good"}})).then(r=>r.json());
assert.equal((await handler(new Request("https://api.example/admin/automation"))).status,401);
let configuration=await readAutomation();assert.equal(configuration.rules.length,24);
const sampleVariables={nome:"Carlos",saudacao:", Carlos",valor:"R$ 350,00",valor_uber:"R$ 350,00",valor_crlv:"R$ 150,00",documentos:"• CNH frente\n• CNH verso\n• documento do carro (CRLV)\n• selfie com fundo branco",faltantes:"CNH frente",documento:"RG verso"};
const demoTemplateLead={id:"template-lead",contact_id:"template-contact",source:"demonstracao",service:"uber",display_name:sampleVariables.nome};
for(const rule of configuration.rules){
 const message=("EDITADO "+rule.id+" "+rule.variables.map(name=>"{"+name+"}").join(" ")).trim();
 let saved=await req("admin/automation",{id:rule.id,message,revision:configuration.revision},{authorization:"Bearer good"});assert.equal(saved.ok,true);
 configuration=await readAutomation();assert.equal(configuration.rules.find(item=>item.id===rule.id).message,message);
 const before=outbound.length;
 await automationSend("test@demo.invalid","DEFAULT",demoTemplateLead,"template-"+rule.id,rule.id,{faltantes:sampleVariables.faltantes,documento:sampleVariables.documento});
 const expected=message.replace(/\{(\w+)\}/g,(_,key)=>sampleVariables[key]).trim();assert.equal(tables.messages.at(-1).body,expected);assert.equal(outbound.length,before);
 saved=await req("admin/automation",{id:rule.id,message:"BAD {token}",revision:configuration.revision},{authorization:"Bearer good"});assert.match(saved.error,/campos disponíveis/);
 saved=await req("admin/automation",{id:rule.id,message:"OK",revision:"old"},{authorization:"Bearer good"});assert.match(saved.error,/outra janela/);
 saved=await req("admin/automation",{id:rule.id,reset:true,revision:configuration.revision},{authorization:"Bearer good"});assert.equal(saved.ok,true);
 configuration=await readAutomation();assert.equal(configuration.rules.find(item=>item.id===rule.id).customized,false);
}
assert.match((await req("admin/automation",{id:"invalid",message:"bad"},{authorization:"Bearer good"})).error,/Gatilho/);
assert.match((await req("admin/automation",{id:"price",message:" ",revision:configuration.revision},{authorization:"Bearer good"})).error,/3000/);
console.log("PASS: all 24 automation templates save, substitute variables, persist, restore defaults, reject unknown fields/stale revisions and never send demo messages externally.");

// Backend media integration: private Storage -> base64 -> WAHA voice/image -> dedupe.
// These tests never connect to a real WhatsApp session.
const mockLead={id:"media-test-lead",contact_id:"media-test-contact",source:"whatsapp",service:"uber"};
tables.business_settings.find(setting=>setting.key==="automation_media").value={
  intro_audio:{path:"intro_audio/intro.mp3",mime_type:"audio/mpeg",enabled:true},
  complete_audio:{path:"complete_audio/final.mp3",mime_type:"audio/mpeg",enabled:true},
  proof_1:{path:"proof_1/prova.png",mime_type:"image/png",enabled:true}
};
let mediaBefore=outbound.length;
assert.equal(await automationSendMedia("test@c.us",mockLead,"intro_audio","test:intro"),true);
assert.equal(outbound.length,mediaBefore+1);
assert.equal(outbound.at(-1).mediaEndpoint,"/api/sendVoice");
assert.equal(outbound.at(-1).file.mimetype,"audio/mpeg");
assert.equal(tables.messages.at(-1).kind,"audio");
assert.equal(await automationSendMedia("test@c.us",mockLead,"intro_audio","test:intro"),true);
assert.equal(outbound.length,mediaBefore+1,"same audio should not be sent twice");
assert.equal(await automationSendMedia("test@c.us",mockLead,"complete_audio","test:complete"),true);
assert.equal(outbound.at(-1).mediaEndpoint,"/api/sendVoice");
assert.equal(await automationSendMedia("test@c.us",mockLead,"proof_1","test:proof"),true);
assert.equal(outbound.at(-1).mediaEndpoint,"/api/sendImage");
assert.equal(outbound.at(-1).file.mimetype,"image/jpeg");
assert.ok(outbound.at(-1).file.filename.endsWith(".jpg"));
assert.equal(tables.messages.at(-1).kind,"image");
assert.equal(await automationSendMedia("test@c.us",mockLead,"proof_1","test:proof"),true);
assert.equal(outbound.length,mediaBefore+3,"proof image must not repeat");
assert.equal((await handler(new Request("https://edge.example/admin/media"))).status,401);
console.log("PASS: media Storage->WAHA audio+image, completion audio, base64 payload, deduplication, message recording and admin auth (mocked).");

// Full documents -> receipt text -> original audio -> one attribution question.
// Reply capture is tested through the real webhook handler, never a real phone.
for(const [answer,expected] of [
  ["1","indicacao"],["2","site"],["3","instagram"],["4","facebook"],["5","youtube"],
  ["Foi indicação de um amigo","indicacao"],["Vim pelo site","site"],
  ["Instagram","instagram"],["Facebook","facebook"],["vídeo do YouTube","youtube"]
]) assert.equal(parseOrigin(answer),expected,"origin parser "+answer);
assert.equal(parseOrigin("Minha conta Uber está bloqueada"),null);
assert.equal(parseOrigin("Você pode analisar o meu CRLV?"),null);

tables.business_settings[0].value={enabled:true};
const originChat="5511999998881@c.us";
const originContact={
 id:"00000000-0000-4000-8000-000000000881",
 chat_id:originChat,phone:originChat.split("@")[0],
 classification:"lead",manual_override:false,
 last_message_at:new Date().toISOString()
};
const originLead={
 id:"00000000-0000-4000-8000-000000000882",contact_id:originContact.id,
 service:"uber",source:"whatsapp",stage:"conversando",
 email:"teste@example.invalid",conversation_context:{},
 conversation_state:"collecting_documents",
 welcome_sent_at:new Date().toISOString(),first_reply_at:new Date().toISOString(),
 automation_paused:false,display_name:"Teste",phone:originContact.phone,
 price_cents:35000,issue:"conta bloqueada"
};
tables.contacts.push(originContact);tables.leads.push(originLead);
for(const kind of ["cnh_frente","cnh_verso","crlv","selfie"]){
  tables.documents.push({id:"complete-"+kind,lead_id:originLead.id,kind,status:"received"});
}
let originBefore=outbound.length;
const originProgress=await automationSendDocumentProgress(originChat,originLead,"complete-origin-1","Recebemos seu último documento.","receipt");
assert.equal(originProgress.missing.length,0);
assert.equal(outbound.length,originBefore+3,"receipt text, completion voice and origin question");
assert.equal(outbound.at(-2).mediaEndpoint,"/api/sendVoice");
assert.match(outbound.at(-1).text,/1\. Indicação/);
assert.match(outbound.at(-1).text,/2\. Site/);
assert.match(outbound.at(-1).text,/3\. Instagram/);
assert.match(outbound.at(-1).text,/4\. Facebook/);
assert.match(outbound.at(-1).text,/5\. Vídeo do YouTube/);
assert.ok(originLead.conversation_context.origin_question_sent_at);
originBefore=outbound.length;
await automationSendDocumentProgress(originChat,originLead,"complete-origin-2","Tudo recebido.","receipt");
assert.equal(outbound.length,originBefore+1,"other progress can be sent, but audio/question cannot repeat");
let originReply=await req("webhook/waha",{
 event:"message",session:"default",payload:{from:originChat,id:"origin-answer-3",body:"3",fromMe:false}
},hookHeaders);
assert.equal(originReply.reported_origin,"instagram");
assert.equal(originLead.conversation_context.origin_confirmed,"instagram");
assert.equal(outbound.at(-1).text,"Perfeito, obrigado! ✅");
assert.equal(tables.messages.at(-2).body,"3","customer response is retained in history");
originBefore=outbound.length;
await req("webhook/waha",{
 event:"message",session:"default",payload:{from:originChat,id:"origin-answer-3",body:"3",fromMe:false}
},hookHeaders);
assert.equal(outbound.length,originBefore,"replayed response cannot resend thanks");
await automationSendDocumentProgress(originChat,originLead,"complete-origin-3","Tudo recebido.","receipt");
assert.equal(outbound.length,originBefore+1,"question stays suppressed even after later progress");

const siteOriginChat="5511999998882@c.us";
const siteOriginContact={...originContact,id:"00000000-0000-4000-8000-000000000883",chat_id:siteOriginChat,phone:siteOriginChat.split("@")[0]};
const siteOriginLead={...originLead,id:"00000000-0000-4000-8000-000000000884",contact_id:siteOriginContact.id,source:"whatsapp",stage:"leads",conversation_context:{origin_question_sent_at:new Date().toISOString()}};
tables.contacts.push(siteOriginContact);tables.leads.push(siteOriginLead);
originReply=await req("webhook/waha",{
 event:"message",session:"default",payload:{from:siteOriginChat,id:"origin-answer-site",body:"2",fromMe:false}
},hookHeaders);
assert.equal(originReply.reported_origin,"site");
assert.equal(siteOriginLead.source,"site");
assert.equal(siteOriginLead.stage,"leads_campaign");
console.log("PASS: completion voice precedes attribution question, five answer choices, stored self-report, site routing and question dedupe (mocked).");


// Ten independent test-evaluate scenarios, over webhook + 5-minute timer,
// without using a real number or disclosing any real customer's documents.
tables.business_settings.find(x=>x.key==="document_batch").value.enabled=true;
const batchTime=Date.now();
const batchReports=[];
for(let cycle=0;cycle<10;cycle++){
  const chat="55119770"+String(cycle).padStart(5,"0")+"@c.us";
  const service=cycle%2===0?"documento":"uber";
  const phone=chat.split("@")[0];
  const incoming=(name,body,filename)=>{
    const media=Boolean(filename);
    return {event:"message",session:"default",payload:{
      from:chat,id:"batch-"+cycle+"-"+name,body,fromMe:false,hasMedia:media,
      ...(media?{media:{url:"https://waha.example/api/files/fixture.png",
        mimetype:"image/jpeg",filename}}:{})
    }};
  };
  const startCount=outbound.length;
  await req("webhook/waha",incoming("start",service==="uber"?"Quero cadastro Uber":"Quero CRLV"),hookHeaders);
  const batchLead=leadForChat(chat);
  assert.equal(batchLead.service,service);
  assert.equal(outbound.length,startCount+2,"Intro must be voice then checklist.");
  assert.equal(outbound.at(-2).mediaEndpoint,"/api/sendVoice");
  const beforeFiles=outbound.length;
  const sends=service==="uber"?["CNH digital.jpg","CRLV.jpg","Selfie.jpg"]:["CRLV.jpg"];
  for(let j=0;j<sends.length;j++){
    ocrResult={text:"",confidence:0,method:"unavailable"};
    const r=await req("webhook/waha",incoming("file"+j,"",sends[j]),hookHeaders);
    assert.equal(r.batch_upload_saved,true);
    assert.equal(outbound.length,beforeFiles,"Do not respond to individual uploaded documents");
  }
  assert.ok(batchLead.conversation_context.batch_has_uploads);
  if(cycle!==2){
    const a=await req("webhook/waha",incoming("email","batch"+cycle+"@example.invalid"),hookHeaders);
    assert.equal(a.batch_waiting,true);
    assert.equal(outbound.length,beforeFiles,"Do not respond to email during file batch");
  }
  assert.equal((await testIdleBatch(Date.now()+4*60_000)).asked,0);
  const triggered=await testIdleBatch(Date.now()+6*60_000);
  assert.equal(triggered.asked,1,"Exactly one reminder after 5-minute inactivity");
  assert.match(outbound.at(-1).text,/Confirma pra mim.*enviou todos/i);
  const afterQuestion=outbound.length;
  assert.equal((await testIdleBatch(Date.now()+7*60_000)).asked,0,"No duplicate prompt");
  assert.equal(outbound.length,afterQuestion);
  if(cycle===3){
    await req("webhook/waha",incoming("no","não"),hookHeaders);
    assert.match(outbound.at(-1).text,/Pode continuar enviando/i);
    assert.equal(batchLead.conversation_state,"collecting_documents");
    assert.equal((await testIdleBatch(Date.now()+4*60_000)).asked,0);
    assert.equal((await testIdleBatch(Date.now()+6*60_000)).asked,1,"No -> next 5-minute cycle");
  }
  const result=await req("webhook/waha",incoming("yes",cycle%3===0?"confirmo":"sim"),hookHeaders);
  assert.equal(result.confirmed,true);
  assert.equal(batchLead.conversation_state,"awaiting_review");
  if(cycle===2){
    assert.equal(result.all_documents_received,false,"Absent email cannot trigger complete audio");
    assert.match(outbound.at(-1).text,/Baiano vai conferir/i);
  }else{
    assert.equal(result.all_documents_received,true,"All requested files plus email present");
    assert.equal(outbound.at(-2).mediaEndpoint,"/api/sendVoice");
    assert.match(outbound.at(-1).text,/Indicação/);
  }
  const afterConfirm=outbound.length;
  await req("webhook/waha",incoming("yes","sim"),hookHeaders);
  assert.equal(outbound.length,afterConfirm,"Do not resend completion on repeated yes");
  batchReports.push({cycle:cycle+1,service,files:sends.length,complete:result.all_documents_received});
}
tables.business_settings.find(x=>x.key==="document_batch").value.enabled=false;
console.log("BATCH_10_ROUNDS "+JSON.stringify(batchReports));



