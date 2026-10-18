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

/*
 * 100 independent scenario executions against the actual shared API.
 * Runs offline. The WAHA transport, Supabase REST and file storage are mocked.
 * Every case uses its own synthetic identifiers; no live customer or account is touched.
 */
const checks = [];
const bot = tables.business_settings[0];
bot.value = {enabled:true};
const hook = {"x-bahiano-webhook-token":"private_token"};
const auth = {authorization:"Bearer good"};
const digits = (group,i) => "5511987"+String(group).padStart(2,"0")+String(i).padStart(4,"0")+"@c.us";
const evt=(id,chat,body,extra={})=>({event:"message",session:"default",payload:{id,from:chat,body,fromMe:false,notifyName:"Teste automatizado",...extra}});
const post=(id,chat,body)=>req("webhook/waha",evt(id,chat,body),hook);
const relatedLead=(chat)=>{const contact=tables.contacts.find(x=>x.chat_id===chat);return contact && tables.leads.find(x=>x.contact_id===contact.id)};
const groups = [
  ["não comercial","entrada de mensagens pessoais/desconhecidas"],
  ["leads orgânicos","detecção de serviços e saudação"],
  ["campanhas","atribuição por referência de campanha"],
  ["primeira resposta","mudança para Conversando sem exigir RG"],
  ["idempotência","eventos repetidos sem duplicar contatos/mensagens"],
  ["contatos pessoais","respeito à classificação manual"],
  ["escopo de automação","robô apenas para números autorizados"],
  ["documentos pendentes","bloqueio de Produção sem documentos verificados"],
  ["Produção sem RG","entrada em Produção com documentos do serviço"],
  ["finalização e pagamento","entrega e confirmação manual do pagamento"],
];
let successCount=0;
async function caseRun(group,index,label,fn) {
  const number=group*10+index+1;
  try{
    await fn();
    successCount++;
    checks.push({number,group:groups[group][0],label,status:"passed"});
    console.log("PASS "+String(number).padStart(3,"0")+"/100 ["+groups[group][0]+"] "+label);
  }catch(error){
    checks.push({number,group:groups[group][0],label,status:"failed",error:String(error)});
    console.error("FAIL "+number+" ["+groups[group][0]+"] "+label,error);
    throw error;
  }
}
const organicInput = [
  ["Preciso de cadastro Uber","uber"],
  ["Preciso do documento do carro","documento"],
  ["Minha CNH venceu","uber"],
  ["Quero revisar CRLV","documento"],
  ["Habilitação com problema","uber"],
  ["Licenciamento do carro","documento"],
  ["Falta EAR na CNH","uber"],
  ["Tenho problema no documento do carro","documento"],
  ["Motorista Uber precisa de cadastro","uber"],
  ["Veículo com documento pendente","documento"],
];
const campaignInput = [
  ["Cadastro Uber, vim pelo site REF:U001","uber","U001"],
  ["Documento do carro, vim pelo site REF:D001","documento","D001"],
  ["CNH sem EAR REF:U002","uber","U002"],
  ["Preciso CRLV REF:D002","documento","D002"],
  ["Habilitação Uber REF:U003","uber","U003"],
  ["Licenciamento do carro REF:D003","documento","D003"],
  ["Motorista Uber REF:U004","uber","U004"],
  ["Veículo com pendência REF:D004","documento","D004"],
  ["Cadastro Uber REF:U005","uber","U005"],
  ["Documento do carro REF:D005","documento","D005"],
];
const organic=[],campaigns=[];
for(let i=0;i<10;i++) await caseRun(0,i,"mensagem neutra ou saudação #"+(i+1),async()=>{
  const chat=digits(10,i),before=tables.leads.length,sentBefore=outbound.length;
  const samples=["Oi, bom dia","Tudo bem?","Obrigado","Bom final de semana","Quero falar com você","Olá","Enviei mensagem errada","Boa noite","Tudo ótimo","Como vai?"];
  const result=await post("unknown-"+i,chat,samples[i]);
  assert.equal(result.classified,"unknown");
  assert.equal(tables.leads.length,before);
  assert.equal(relatedLead(chat),undefined);
  const shouldGreet=[0,1,5,7,9].includes(i);
  assert.equal(outbound.length,sentBefore+(shouldGreet?1:0));
  if(shouldGreet)assert.match(outbound.at(-1).text,/Oi! Tudo bem|Oi, .*Tudo bem/i);
});
for(let i=0;i<10;i++) await caseRun(1,i,"orgânico "+organicInput[i][1]+" #"+(i+1),async()=>{
  const chat=digits(11,i),[body,service]=organicInput[i],before=outbound.length;
  const result=await post("organic-"+i,chat,body);
  const lead=relatedLead(chat);assert.ok(lead);
  assert.equal(result.first,true);
  assert.equal(lead.service,service);
  assert.equal(lead.source,"whatsapp");
  assert.equal(lead.stage,"leads");
  assert.equal(lead.price_cents,service==="uber"?35000:15000);
  assert.equal(outbound.length,before+1);
  assert.doesNotMatch(outbound.at(-1).text,/\bRG\b/i);
  organic.push({chat,lead,id:"organic-"+i,service});
});
for(let i=0;i<10;i++) await caseRun(2,i,"campanha rastreada "+campaignInput[i][2],async()=>{
  const chat=digits(12,i),[body,service,code]=campaignInput[i],before=outbound.length;
  const result=await post("campaign-"+i,chat,body);
  const lead=relatedLead(chat);assert.ok(lead);
  assert.equal(result.first,true);
  assert.equal(lead.service,service);
  assert.equal(lead.stage,"leads_campaign");
  assert.equal(lead.source,"site");
  assert.equal(lead.campaign_code,code);
  assert.equal(outbound.length,before+1);
  assert.doesNotMatch(outbound.at(-1).text,/\bRG\b/i);
  campaigns.push({chat,lead,id:"campaign-"+i,service});
});
for(let i=0;i<10;i++) await caseRun(3,i,"cliente respondeu "+(i+1),async()=>{
  const item=organic[i],before=outbound.length;
  const result=await post("reply-"+i,item.chat,i%2?"Concordo, envie a relação de documentos":"Ok, vou enviar os documentos");
  assert.equal(result.stage,"conversando");
  assert.equal(item.lead.stage,"conversando");
  assert.ok(item.lead.first_reply_at);
  assert.ok(outbound.length>before);
  assert.doesNotMatch(outbound.at(-1).text,/\bRG\b/i);
});
for(let i=0;i<10;i++) await caseRun(4,i,"evento duplicado "+(i+1),async()=>{
  const item=organic[i],b=tables.messages.length,s=outbound.length,l=tables.leads.length;
  const result=await post(item.id,item.chat,organicInput[i][0]);
  assert.equal(result.duplicate,true);
  assert.equal(tables.messages.length,b);
  assert.equal(outbound.length,s);
  assert.equal(tables.leads.length,l);
});
for(let i=0;i<10;i++) await caseRun(5,i,"conversa pessoal protegida "+(i+1),async()=>{
  const chat=digits(13,i),count=tables.leads.length,sent=outbound.length;
  tables.contacts.push({id:"00000000-0000-4000-8000-"+String(1000+i).padStart(12,"0"),chat_id:chat,phone:chat.slice(0,-5),classification:"personal",manual_override:true});
  const result=await post("personal-"+i,chat,i%2?"CNH vencida, Uber, cadastro":"Documento do carro CRLV Uber");
  assert.equal(result.classified,"personal");
  assert.equal(tables.leads.length,count);
  assert.equal(outbound.length,sent);
});
for(let i=0;i<10;i++) await caseRun(6,i,"restrição de destinatário "+(i+1),async()=>{
  const chat=digits(14,i),allowed=i%2===0,before=outbound.length;
  bot.value={enabled:true,test_chat_ids:allowed?[chat]:["5511999999999@c.us"]};
  const result=await post("restricted-"+i,chat,"Preciso de cadastro Uber");
  const lead=relatedLead(chat);
  assert.ok(lead);assert.equal(result.first,true);
  assert.equal(outbound.length,before+(allowed?1:0));
  assert.equal(Boolean(lead.welcome_sent_at),allowed);
  if(allowed)assert.doesNotMatch(outbound.at(-1).text,/\bRG\b/i);
});
bot.value={enabled:true};
const ubers=[...organic,...campaigns].filter(item=>item.service==="uber");
const docsCar=[...organic,...campaigns].filter(item=>item.service==="documento");
assert.equal(ubers.length,10,"Expected 10 Uber customers for requirements suite");
assert.equal(docsCar.length,10,"Expected 10 CRLV customers for requirements suite");
const kinds=["cnh_frente","cnh_verso","crlv","selfie"];
const labels={cnh_frente:"CNH frente",cnh_verso:"CNH verso",crlv:"documento do carro (CRLV)",selfie:"selfie com fundo branco"};
const included=[[],["cnh_frente"],["cnh_verso"],["crlv"],["selfie"],["cnh_frente","cnh_verso"],["cnh_frente","crlv"],["cnh_verso","selfie"],["crlv","selfie"],["cnh_frente","cnh_verso","crlv"]];
for(let i=0;i<10;i++) await caseRun(7,i,"Uber falta documentos "+(i+1),async()=>{
  const lead=ubers[i].lead;lead.email="uber-"+i+"@example.test";
  for(const kind of included[i])tables.documents.push({id:"test-uber-doc-"+i+"-"+kind,lead_id:lead.id,kind,status:"verified"});
  const result=await req("admin/production",{lead_id:lead.id},auth);
  assert.equal(result.error,"Faltam documentos verificados");
  const expected=kinds.filter(x=>!included[i].includes(x)).map(x=>labels[x]);
  assert.equal(result.missing.length,expected.length);
  assert.deepEqual([...result.missing].sort(),[...expected].sort());
  assert.doesNotMatch(JSON.stringify(result.missing),/\bRG\b/i);
  assert.notEqual(lead.stage,"producao");
});
for(let i=0;i<10;i++) await caseRun(8,i,"CRLV verificado sem RG "+(i+1),async()=>{
  const lead=docsCar[i].lead;lead.email="documento-"+i+"@example.test";
  tables.documents.push({id:"test-car-crlv-"+i,lead_id:lead.id,kind:"crlv",status:"verified"});
  if(i%2)tables.documents.push({id:"test-car-rg-optional-"+i,lead_id:lead.id,kind:"rg_frente",status:"received"});
  const before=outbound.length;
  const result=await req("admin/production",{lead_id:lead.id},auth);
  assert.equal(result.ok,true);
  assert.equal(lead.stage,"producao");
  assert.ok(lead.documents_complete_at);
  assert.equal(outbound.length,before+1);
  assert.match(outbound.at(-1).text,/Recebemos todos os seus documentos/i);
  assert.doesNotMatch(outbound.at(-1).text,/\bRG\b/i);
});
for(let i=0;i<10;i++) await caseRun(9,i,"entrega e pagamento "+(i+1),async()=>{
  const lead=docsCar[i].lead;const before=outbound.length;
  let result=await req("admin/finish",{lead_id:lead.id},auth);
  assert.equal(result.ok,true);assert.equal(lead.stage,"finalizados");
  assert.equal(outbound.length,before+1);
  assert.match(outbound.at(-1).text,/videochamada/i);
  result=await req("admin/payment",{lead_id:lead.id},auth);
  assert.match(result.error,/entregue/);
  assert.notEqual(lead.payment_status,"confirmed");
  result=await req("admin/deliver",{lead_id:lead.id},auth);
  assert.equal(result.ok,true);assert.ok(lead.delivered_at);
  result=await req("admin/payment",{lead_id:lead.id},auth);
  assert.equal(result.ok,true);assert.equal(lead.payment_status,"confirmed");
  assert.equal(lead.stage,"pagos");assert.ok(lead.paid_at);
  result=await req("admin/payment",{lead_id:lead.id},auth);
  assert.ok(result.error,"Repeat payment must be rejected");
});


// 1,000 isolated multi-turn conversations exercising the deterministic sales funnel.
// All contacts, messages and identifiers are synthetic; WAHA and Supabase remain mocked.
const conversationNames = [
  "Carlos Silva","Ana Souza","João Pedro","Maria","Lucas Pereira","Bruna",
  "Pedro","Mariana","João","Carla","WhatsApp User","5511999999999",
  "Teste automatizado","Contato","d'Ávila","Fernanda Costa","Rafael","Luísa"
];
function expectedFirstName(raw) {
  const normalized=String(raw||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^\p{L}\p{N}@._+-]+/gu," ").replace(/\s+/g," ").trim();
  const generic=new Set(["whatsapp","whatsapp user","user","unknown","unknown contact","sem nome","sem identificacao","teste","teste automatizado","teste anonimo","contato","cliente","eu","eu pessoal","atendimento"]);
  if(!raw||generic.has(normalized)||/@|^\+?\d[\d\s()+-]*$/.test(raw))return "";
  const token=String(raw).replace(/[^\p{L}\p{M}'’.-]+/gu," ").trim().split(/\s+/)[0]?.replace(/[.]+$/,"")||"";
  if(!/^\p{L}[\p{L}\p{M}'’-]{0,23}$/u.test(token)||generic.has(token.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()))return "";
  return token.charAt(0).toLocaleUpperCase("pt-BR")+token.slice(1).toLocaleLowerCase("pt-BR");
}
async function postConversation(id,chat,body,name) {
  return req("webhook/waha",{event:"message",session:"default",payload:{
    id,from:chat,body,fromMe:false,notifyName:name
  }},hook);
}
const conversationReports=[];
const conversationTypes=[
  {name:"greeting to Uber",service:"uber"},
  {name:"greeting to CRLV",service:"documento"},
  {name:"price question to Uber",service:"uber"},
  {name:"direct Uber qualification and FAQ",service:"uber"},
  {name:"direct CRLV qualification and objection",service:"documento"},
];
const greetingVariants=["Oi","Olá, bom dia","Boa tarde","Oi, tudo bem?","E aí","Bom dia","Boa noite","Opa","Olá","Fala"];
const uberServiceVariants=[
  "Quero criar conta Uber","Preciso de cadastro Uber","Quero fazer uma conta na Uber",
  "Me ajuda com a conta Uber","Quero trabalhar de Uber","Preciso regularizar meu cadastro Uber",
  "Quero entrar na Uber","Tenho interesse no cadastro Uber","Quero resolver problema na conta Uber",
  "Ajuda com cadastro de motorista Uber"
];
const carServiceVariants=[
  "Preciso do CRLV","Preciso do documento do carro","Quero resolver uma pendência no licenciamento do carro",
  "Preciso regularizar o documento do veículo","Tenho problema com CRLV","Quero ajuda com o documento do carro",
  "O licenciamento do carro está pendente","Preciso de ajuda com o CRLV","Documento do carro, por favor",
  "Meu veículo precisa do documento"
];
const uberAnswers=[
  "Do zero","Quero criar uma conta nova","É a primeira vez","Já tenho uma conta bloqueada",
  "Minha CNH venceu","Estou sem EAR","Não consigo entrar na conta","Minha conta foi suspensa",
  "Minha conta está bloqueada","Ainda não tenho conta"
];
const carAnswers=[
  "O documento está vencido","Tenho uma pendência no licenciamento","Preciso regularizar o CRLV",
  "O CRLV está vencido","Está com restrição no documento","Meu documento venceu",
  "Preciso atualizar o documento do carro","O licenciamento está pendente","O documento está atrasado",
  "Tenho problema no CRLV"
];
const consentVariants=["Pode seguir","Sim","Ok","Pode mandar os documentos","Concordo","Quero seguir","Estou de acordo","Bora","Fechado","Pode enviar os documentos"];
const faqVariants=["Quanto tempo demora?","Como funciona?","E se não der certo?","Posso enviar a CNH digital?","É garantido?","Qual o prazo?","O que está incluído?","Tem aprovação garantida?","Pode me explicar melhor?","E se a Uber não aprovar?"];
const objectionVariants=["Não","Agora não","Estou com dúvida","Quanto custa?","Pode me explicar melhor?","Achei caro","Como funciona?","E se não der certo?","Qual o prazo?","Vou pensar"];
for(let i=0;i<1000;i++){
  const chat=digits(30+Math.floor(i/100),i%100);
  const name=conversationNames[i%conversationNames.length];
  const first=expectedFirstName(name);
  const mode=i%5, v=Math.floor(i/5);
  const greet=greetingVariants[(i*7+v)%greetingVariants.length];
  const uber=uberServiceVariants[(i*3+v*7)%uberServiceVariants.length];
  const car=carServiceVariants[(i*7+v*3)%carServiceVariants.length];
  const uberAnswer=uberAnswers[(i*9+v*3)%uberAnswers.length];
  const carAnswer=carAnswers[(i*7+v*9)%carAnswers.length];
  const consent=consentVariants[(i*3+v*7)%consentVariants.length];
  const scenario=mode===0
    ? {first:greet,second:uber,third:uberAnswer,fourth:consent,service:"uber",greetingFirst:true,ambiguousFirst:false}
    : mode===1
      ? {first:greet,second:car,third:carAnswer,fourth:consent,service:"documento",greetingFirst:true,ambiguousFirst:false}
      : mode===2
        ? {first:"Quanto custa?",second:uber,third:uberAnswer,fourth:consent,service:"uber",greetingFirst:false,ambiguousFirst:true}
        : mode===3
          ? {first:uber,second:uberAnswer,third:faqVariants[v%faqVariants.length],fourth:consent,service:"uber",greetingFirst:false,ambiguousFirst:false}
          : {first:car,second:carAnswer,third:objectionVariants[v%objectionVariants.length],fourth:consent,service:"documento",greetingFirst:false,ambiguousFirst:false};
  const base=outbound.length;
  try{
    await postConversation("conv-"+i+"-1",chat,scenario.first,name);
    assert.equal(outbound.length,base+1,"every opening must receive exactly one response");
    const firstReply=outbound.at(-1).text;
    if(scenario.greetingFirst){
      assert.match(firstReply,/Tudo bem/i);
      assert.match(firstReply,/Uber/);
      assert.match(firstReply,/CRLV/);
      if(first)assert.ok(firstReply.includes(first),"greeting should use the contact's first name");
      else assert.doesNotMatch(firstReply,/Oi, (?:WhatsApp|Teste|Contato|5511|User)!/i);
      assert.equal(relatedLead(chat),undefined,"a greeting alone must not pollute the sales Kanban");
    } else {
      assert.ok(firstReply.length>35);
      if(scenario.ambiguousFirst){
        assert.match(firstReply,/R\$ 350,00/);
        assert.match(firstReply,/R\$ 150,00/);
        assert.equal(relatedLead(chat),undefined,"an ambiguous price inquiry should qualify service before creating a lead");
      } else {
        assert.match(firstReply,/R\$ (?:350|150),00/);
      }
      if(first)assert.ok(firstReply.includes(first),"opening should personalize from WhatsApp name");
    }
    await postConversation("conv-"+i+"-2",chat,scenario.second,name);
    assert.equal(outbound.length,base+2,"service selection must receive a contextual reply");
    const lead=relatedLead(chat);
    assert.ok(lead,"a qualified service must create a lead");
    assert.equal(lead.service,scenario.service);
    assert.match(outbound.at(-1).text,/R\$ (?:350|150),00/);
    assert.match(outbound.at(-1).text,scenario.service==="uber"?/conta do zero|conta que j[aá] existe/i:/CRLV|documento do carro/i);
    await postConversation("conv-"+i+"-3",chat,scenario.third,name);
    assert.equal(outbound.length,base+3,"qualification, FAQ or objection must be answered");
    assert.equal(lead.conversation_state,"offer_consent","the customer should remain in the consent step until they agree");
    await postConversation("conv-"+i+"-4",chat,scenario.fourth,name);
    assert.equal(outbound.length,base+4,"consent or document request must receive one reply");
    assert.equal(lead.conversation_state,"collecting_documents");
    assert.match(outbound.at(-1).text,/CNH|CRLV|documento do carro/i);
    assert.match(outbound.at(-1).text,/E-mail/i);
    assert.equal(lead.stage,"conversando");
    conversationReports.push({number:i+1,scenario:mode,service:lead.service,personalized:Boolean(first),status:"passed"});
  }catch(error){
    console.error("CONVERSATION_1000_FAIL",i+1,{chat,name,scenario,error:String(error)});
    throw error;
  }
}
assert.equal(conversationReports.length,1000,"All 1,000 multi-turn conversations must pass");
console.log("CONVERSATION_1000_REPORT "+JSON.stringify({
  total:conversationReports.length,
  passed:conversationReports.filter(x=>x.status==="passed").length,
  failed:0,
  scenarios:conversationTypes.map((x,i)=>({scenario:i+1,service:x.service,cases:conversationReports.filter(c=>c.scenario===i).length})),
  personalization:conversationReports.filter(x=>x.personalized).length,
  transport:"mocked Supabase and WAHA",
  liveMessagesSent:0
}));

assert.equal(successCount,100);
assert.equal(checks.length,100);
assert.equal(checks.filter(x=>x.status==="passed").length,100);
const groupCounts=groups.map((g,i)=>({group:i+1,area:g[0],cases:checks.filter(x=>x.group===g[0]).length}));
console.log("AUTOMATION_100_REPORT "+JSON.stringify({passed:successCount,failed:0,total:100,groups:groupCounts,transport:"mocked Supabase and WAHA",liveMessagesSent:0}));
