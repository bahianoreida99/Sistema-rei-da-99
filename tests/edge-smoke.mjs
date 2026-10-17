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
  business_settings: [{ key: "bot", value: { enabled: true } }],
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
const automationSend = vm.runInNewContext(
  js.outputText + "\n;send;",
  {
    BahianoReadDocument: async () => ocrResult,
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
assert.equal(r.first, true);
assert.equal(tables.leads.length, 1);
assert.equal(tables.leads[0].stage, "leads_campaign");
assert.equal(outbound.length, 1);
assert.match(outbound[0].text, /R\$ 350,00/);
assert.doesNotMatch(outbound[0].text, /\bRG\b/i, 'Mensagem inicial não deve pedir RG');
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
assert.equal(r.first, true);
const resolved = tables.contacts.find(c => c.chat_id === lidChat);
assert.ok(resolved, "LID alternative JID must identify the customer phone");
assert.equal(tables.contacts.some(c => c.chat_id === lidValue), false);
const resolvedLead = tables.leads.find(l => l.contact_id === resolved.id);
assert.equal(resolvedLead.service, "uber");
assert.equal(resolvedLead.stage, "leads");
assert.equal(outbound.length, lidSentBefore + 1);
assert.equal(outbound.at(-1).chatId, lidChat);
assert.doesNotMatch(outbound.at(-1).text, /\bRG\b/i);
r = await req("webhook/waha", lidBody("lid-case-2", "Ok, vou enviar os documentos"), { "x-bahiano-webhook-token": "private_token" });
assert.equal(resolvedLead.stage, "conversando");
assert.equal(r.stage, "conversando");
r = await req("webhook/waha", lidBody("lid-case-2", "Ok, vou enviar os documentos"), { "x-bahiano-webhook-token": "private_token" });
assert.equal(r.duplicate, true);
console.log("PASS: real WAHA @lid payload resolves to sender phone, sends welcome and advances to Conversando.");

// Untrusted contacts do not enter the board by arrival alone.
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
assert.equal(r.classified, "unknown");
assert.equal(tables.leads.length, count);
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
assert.equal(tables.leads.length, count);
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
assert.equal(outbound.length, sentCount + 1);
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
assert.equal(r.first, true);
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
assert.deepEqual(sessionActions, ["restart"]);
sessionActions.length = 0;
failLogout = true;
assert.equal((await whatsappRequest("disconnect")).status, 503);
assert.deepEqual(sessionActions, ["logout"]);
console.log(
  "PASS: protected WhatsApp pairing, method restrictions, no reset of QR/starting/working sessions, manual phone confirmation preserved, start stopped session, single restart after failure, logout then stop and logout failure.",
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
  assert.match(outbound.at(-1).text,/Para continuar/);
  ocrResult = { text: "Paisagem com arvores e flores sem documento", confidence: 94, method: "image_ocr" };
  await req("webhook/waha", incoming("unknown", "", true), hookHeaders);
  const unknown = tables.documents.at(-1);assert.equal(unknown.kind, "outro");assert.equal(unknown.status, "received");
  assert.match(outbound.at(-1).text, /confirmar o tipo/);
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
let configuration=await readAutomation();assert.equal(configuration.rules.length,17);
const sampleVariables={nome:"Cliente Teste",valor:"R$ 350,00",faltantes:"CNH frente",documento:"RG verso"};
const demoTemplateLead={id:"template-lead",contact_id:"template-contact",source:"demonstracao",service:"uber",display_name:sampleVariables.nome};
for(const rule of configuration.rules){
 const message="EDITADO "+rule.id+" "+rule.variables.map(name=>"{"+name+"}").join(" ");
 let saved=await req("admin/automation",{id:rule.id,message,revision:configuration.revision},{authorization:"Bearer good"});assert.equal(saved.ok,true);
 configuration=await readAutomation();assert.equal(configuration.rules.find(item=>item.id===rule.id).message,message);
 const before=outbound.length;
 await automationSend("test@demo.invalid","DEFAULT",demoTemplateLead,"template-"+rule.id,rule.id,{faltantes:sampleVariables.faltantes,documento:sampleVariables.documento});
 const expected=message.replace(/\{(\w+)\}/g,(_,key)=>sampleVariables[key]);assert.equal(tables.messages.at(-1).body,expected);assert.equal(outbound.length,before);
 saved=await req("admin/automation",{id:rule.id,message:"BAD {token}",revision:configuration.revision},{authorization:"Bearer good"});assert.match(saved.error,/campos disponíveis/);
 saved=await req("admin/automation",{id:rule.id,message:"OK",revision:"old"},{authorization:"Bearer good"});assert.match(saved.error,/outra janela/);
 saved=await req("admin/automation",{id:rule.id,reset:true,revision:configuration.revision},{authorization:"Bearer good"});assert.equal(saved.ok,true);
 configuration=await readAutomation();assert.equal(configuration.rules.find(item=>item.id===rule.id).customized,false);
}
assert.match((await req("admin/automation",{id:"invalid",message:"bad"},{authorization:"Bearer good"})).error,/Gatilho/);
assert.match((await req("admin/automation",{id:"price",message:" ",revision:configuration.revision},{authorization:"Bearer good"})).error,/3000/);
console.log("PASS: all 17 automation templates save, substitute variables, persist, restore defaults, reject unknown fields/stale revisions and never send demo messages externally.");
