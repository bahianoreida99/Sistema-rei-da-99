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
const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake_server_only",
  SUPABASE_ANON_KEY: "test_public",
  WAHA_BASE_URL: "https://waha.example",
  WAHA_API_KEY: "test_waha",
  BAHIANO_WEBHOOK_TOKEN: "private_token",
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
      ? fakeJson({
          email: "bahiano.reida99uber@gmail.com",
          email_confirmed_at: "2026-10-01T00:00:00Z",
        })
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
vm.runInNewContext(
  js.outputText,
  {
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
  "rg_frente",
  "rg_verso",
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
      url: "https://waha.example/api/files/proof",
      mimetype: "image/jpeg",
    },
  }),
  { "x-bahiano-webhook-token": "private_token" },
);
assert.equal(lead.payment_status, "proof_received");
assert.equal(lead.stage, "finalizados");
assert.equal(tables.documents.at(-1).kind, "comprovante");
// console.log('PASS: webhook authorization, classified site lead, first-message staging, deduplication, reply moves to Conversando, admin production, admin finalization, paid-proof staged (not paid), private document storage.');

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
