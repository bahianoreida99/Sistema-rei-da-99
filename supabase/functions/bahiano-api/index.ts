/**
 * Bahiano da 99 — API Supabase Edge.
 * Secrets are configured in Supabase's Edge Function secrets, NEVER committed.
 * Deploy with verify_jwt=false because this service has two distinct authentication
 * paths: user JWT verified against Supabase Auth for /admin/* and a private
 * webhook token verified for /webhook/waha. No route performs writes unauthenticated.
 */
const E = Deno.env;
const url = E.get("SUPABASE_URL") || "";
const dbKey = E.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const publicKey = E.get("SUPABASE_ANON_KEY") || "";
const wahaUrl = (E.get("WAHA_BASE_URL") || "").replace(/\/$/, "");
const wahaPublicUrl = (E.get("WAHA_PUBLIC_URL") || wahaUrl).replace(/\/$/, "");
const wahaKey = E.get("WAHA_API_KEY") || "";
const hookKey = E.get("BAHIANO_WEBHOOK_TOKEN") || E.get("WEBHOOK_TOKEN") || "";
const required = [
  "cnh_frente",
  "cnh_verso",
  "crlv",
  "selfie",
];
const requiredFor = (lead: any): string[] =>
  lead.service === "documento" ? ["crlv"] : required;
const docs: Record<string, string> = {
  cnh_frente: "CNH frente",
  cnh_sem_lado: "CNH (lado a confirmar)",
  cnh_completa: "CNH digital (frente e verso)",
  cnh_verso: "CNH verso",
  rg_frente: "RG frente",
  rg_verso: "RG verso",
  crlv: "documento do carro (CRLV)",
  selfie: "selfie com fundo branco",
};
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, x-client-info, content-type, x-bahiano-webhook-token",
};
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
  });
const apiHeaders = () => ({
  apikey: dbKey,
  Authorization: `Bearer ${dbKey}`,
  "Content-Type": "application/json",
});
const up = (t: string, q = "") => url + "/rest/v1/" + t + q;
async function rows(t: string, q = ""): Promise<any[]> {
  const r = await fetch(up(t, q), { headers: apiHeaders(), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw Error(`Falha na leitura de ${t}: ${r.status}`);
  return await r.json();
}
async function insert(t: string, value: Record<string, unknown>): Promise<any> {
  const r = await fetch(up(t), {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: { ...apiHeaders(), Prefer: "return=representation" },
    body: JSON.stringify(value),
  });
  if (!r.ok) {
    const err = await r.text();
    if (r.status === 409 || err.includes("23505")) return null;
    throw Error(`Falha ao gravar ${t}: ${r.status}`);
  }
  return (await r.json())[0];
}
async function update(
  t: string,
  id: string,
  value: Record<string, unknown>,
): Promise<any> {
  const r = await fetch(up(t, `?id=eq.${encodeURIComponent(id)}`), {
    method: "PATCH",
    signal: AbortSignal.timeout(10000),
    headers: { ...apiHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({
      ...value,
      ...(["contacts", "leads"].includes(t)
        ? { updated_at: new Date().toISOString() }
        : {}),
    }),
  });
  if (!r.ok) throw Error(`Falha ao atualizar ${t}: ${r.status}`);
  return (await r.json())[0];
}
async function getLead(id: string) {
  return (await rows("leads", `?id=eq.${encodeURIComponent(id)}&select=*`))[0];
}
async function getContact(id: string) {
  return (
    await rows("contacts", `?id=eq.${encodeURIComponent(id)}&select=*`)
  )[0];
}
async function checkAdmin(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!token || !url || !publicKey) return false;
  const r = await fetch(url + "/auth/v1/user", {
    headers: { apikey: publicKey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) return false;
  const u = await r.json();
  return Boolean(E.get("BAHIANO_ADMIN_USER_ID")) && u.id === E.get("BAHIANO_ADMIN_USER_ID") &&
    !!u.email_confirmed_at
    ? u
    : false;
}
async function safeToken(got: string, expected: string) {
  if (!got || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(got)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a),
    y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
async function botOn(chatId?: string) {
  const v = (await rows("business_settings", "?key=eq.bot&select=value"))[0]
    ?.value;
  return v?.enabled === true &&
    (!Array.isArray(v.test_chat_ids) ||
      (Boolean(chatId) && v.test_chat_ids.includes(chatId)));
}
async function send(
  chatId: string,
  message: string,
  lead: any,
  actionKey?: string,
  templateId?: string,
  variables: Record<string, string> = {},
) {
  if (
    actionKey &&
    (
      await rows(
        "messages",
        "?action_key=eq." + encodeURIComponent(actionKey) + "&select=id",
      )
    ).length
  )
    return;
  if (templateId) {
    const settings = (await rows("business_settings", "?key=eq.automation_messages&select=value"))[0]?.value || {};
    const template = settings[templateId];
    if (typeof template === "string" && template.trim()) {
      const values = { nome: firstName(lead.display_name) || "cliente", saudacao: firstName(lead.display_name) ? ", " + firstName(lead.display_name) : "", valor: lead.service === "documento" ? "R$ 150,00" : "R$ 350,00", valor_uber: "R$ 350,00", valor_crlv: "R$ 150,00", documentos: requiredFor(lead).map(kind => "• " + docs[kind]).join("\n"), ...variables };
      message = template.replace(/\{(\w+)\}/g, (match: string, key: string) => values[key as keyof typeof values] ?? match);
    }
  }
  if (lead.source === "demonstracao") {
    await insert("messages", {
      lead_id: lead.id,
      contact_id: lead.contact_id,
      waha_id: "demo-" + crypto.randomUUID(),
      direction: "outgoing",
      kind: "text",
      body: message,
      action_key: actionKey || null,
    });
    return;
  }
  if (!wahaUrl || !wahaKey) throw Error("WAHA não configurado");
  const r = await fetch(wahaUrl + "/api/sendText", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", "X-Api-Key": wahaKey },
    body: JSON.stringify({ session: "default", chatId, text: message }),
  });
  if (!r.ok) throw Error("Não foi possível enviar WhatsApp: " + r.status);
  const sent = await r.json();
  const id =
    typeof sent.id === "string"
      ? sent.id
      : sent.id?._serialized || (sent.key?.id ? "true_" + chatId + "_" + sent.key.id : "out-" + crypto.randomUUID());
  const saved = await insert("messages", {
    lead_id: lead.id,
    contact_id: lead.contact_id,
    waha_id: id,
    direction: "outgoing",
    kind: "text",
    body: message,
    action_key: actionKey || null,
  });
  if (!saved && actionKey) {
    const existing = (
      await rows(
        "messages",
        "?waha_id=eq." + encodeURIComponent(id) + "&select=id",
      )
    )[0];
    if (existing)
      await update("messages", existing.id, { action_key: actionKey });
  }
}
/**
 * Private automation media (audio and images), integrated with WAHA.
 * Original uploaded bytes stay unchanged in Supabase Storage.
 */
const BUCKET = "bahiano-automacao";
const MEDIA_SLOTS = ["intro_audio","complete_audio","proof_1","proof_2","proof_3","proof_4","proof_5"];
function createMediaBridge(deps:any) {
  const {rows,insert,checkAdmin,response,up,apiHeaders,url,dbKey,wahaUrl,wahaKey}=deps;
  const settings=async ():Promise<Record<string,any>> =>
    (await rows("business_settings","?key=eq.automation_media&select=value"))[0]?.value || {};
  async function sendMedia(chatId:string,lead:any,slot:string,actionKey:string):Promise<boolean> {
    if (!lead?.id || !MEDIA_SLOTS.includes(slot)) return false;
    const asset=(await settings())[slot];
    if(!asset?.path || asset.enabled!==true) return false;
    if((await rows("messages","?action_key=eq."+encodeURIComponent(actionKey)+"&select=id")).length) return true;
    const path=String(asset.path),mime=String(asset.mime_type||"");
    const voice=slot.endsWith("_audio");
    if(!path.startsWith(slot+"/") || !/^[a-z0-9_/-]+\.(?:mp3|ogg|jpg|png|webp)$/i.test(path) ||
       !(voice ? ["audio/mpeg","audio/ogg"].includes(mime) : ["image/jpeg","image/png","image/webp"].includes(mime)))
      throw Error("Arquivo de automação inválido");
    const download=await fetch(url+"/storage/v1/object/authenticated/"+BUCKET+"/"+path,{
      headers:{apikey:dbKey,Authorization:"Bearer "+dbKey},redirect:"error",
      signal:AbortSignal.timeout(12000)
    });
    if(!download.ok) throw Error("Mídia não disponível: "+download.status);
    const bytes=new Uint8Array(await download.arrayBuffer());
    if(!bytes.length || bytes.length>5*1024*1024) throw Error("Tamanho de mídia inválido");
    let outboundBytes=bytes, outboundMime=mime, outboundName=path.split("/").pop()||"arquivo";
    if (!voice && mime!=="image/jpeg") {
      const converter=(globalThis as any).BahianoConvertToJpeg;
      if (typeof converter!=="function") throw Error("Conversão de imagem indisponível");
      outboundBytes = new Uint8Array(await converter(bytes));
      if (outboundBytes.length<3 || outboundBytes[0]!==255 || outboundBytes[1]!==216)
        throw Error("Falha ao converter imagem para JPEG");
      outboundMime="image/jpeg";
      outboundName=outboundName.replace(/\.(png|webp)$/i,".jpg");
    }
    let raw="";
    for(let i=0;i<outboundBytes.length;i+=8192) raw+=String.fromCharCode(...outboundBytes.subarray(i,i+8192));
    const payload:Record<string,unknown>={
      session:"default",chatId,file:{mimetype:outboundMime,filename:outboundName,data:btoa(raw)}
    };
    if(voice) payload.convert=mime==="audio/mpeg";
    if(!wahaUrl || !wahaKey) throw Error("WAHA não configurado");
    const out=await fetch(wahaUrl+(voice?"/api/sendVoice":"/api/sendImage"),{
      method:"POST",headers:{"Content-Type":"application/json","X-Api-Key":wahaKey},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)
    });
    if(!out.ok) throw Error("Falha ao enviar mídia no WhatsApp: "+out.status);
    const sent=await out.json();
    const id=typeof sent.id==="string" ? sent.id :
      sent.id?._serialized || (sent.key?.id ? "true_"+chatId+"_"+sent.key.id : "out-"+crypto.randomUUID());
    await insert("messages",{
      lead_id:lead.id,contact_id:lead.contact_id,waha_id:id,direction:"outgoing",
      kind:voice?"audio":"image",body:slot,media_mime:outboundMime,action_key:actionKey
    });
    return true;
  }
  function validMagic(bytes:Uint8Array,mime:string):boolean {
    const chunk=(a:number,b:number)=>String.fromCharCode(...bytes.subarray(a,b));
    if(mime==="audio/mpeg")return chunk(0,3)==="ID3" || (bytes[0]===255 && (bytes[1]&224)===224);
    if(mime==="audio/ogg")return chunk(0,4)==="OggS";
    if(mime==="image/jpeg")return bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
    if(mime==="image/png")return bytes[0]===137 && chunk(1,4)==="PNG";
    if(mime==="image/webp")return chunk(0,4)==="RIFF" && chunk(8,12)==="WEBP";
    return false;
  }
  async function route(req:Request,pathname:string) {
    if(!await checkAdmin(req))return response({error:"Não autorizado"},401);
    if(pathname==="/admin/media" && req.method==="GET")
      return response({slots:MEDIA_SLOTS,assets:await settings()});
    if(pathname!=="/admin/media/upload" || req.method!=="POST")
      return response({error:"Rota não encontrada"},404);
    const slot=new URL(req.url).searchParams.get("slot")||"";
    if(!MEDIA_SLOTS.includes(slot))return response({error:"Tipo de mídia inválido"},400);
    const mime=(req.headers.get("content-type")||"").split(";")[0].toLowerCase().trim();
    const extensions:Record<string,string>={
      "audio/mpeg":"mp3","audio/ogg":"ogg","image/jpeg":"jpg",
      "image/png":"png","image/webp":"webp"
    };
    if(!extensions[mime] || (slot.endsWith("_audio")!==mime.startsWith("audio/")))
      return response({error:"Formato não aceito"},415);
    const bytes=new Uint8Array(await req.arrayBuffer());
    if(bytes.length<12 || bytes.length>5*1024*1024 || !validMagic(bytes,mime))
      return response({error:"Arquivo inválido ou maior que 5 MB"},400);
    const path=slot+"/"+crypto.randomUUID()+"."+extensions[mime];
    const stored=await fetch(url+"/storage/v1/object/"+BUCKET+"/"+path,{
      method:"POST",headers:{apikey:dbKey,Authorization:"Bearer "+dbKey,"Content-Type":mime},
      body:bytes,signal:AbortSignal.timeout(30000)
    });
    if(!stored.ok)return response({error:"Falha ao armazenar mídia: "+stored.status},503);
    const current=await settings();
    const next={...current,[slot]:{
      path,mime_type:mime,bytes:bytes.length,enabled:true,uploaded_at:new Date().toISOString()
    }};
    const result=await fetch(up("business_settings","?key=eq.automation_media"),{
      method:"PATCH",headers:{...apiHeaders(),Prefer:"return=representation"},
      body:JSON.stringify({value:next,updated_at:new Date().toISOString()}),
      signal:AbortSignal.timeout(10000)
    });
    if(!result.ok)return response({error:"Arquivo salvo mas mídia ainda não ativada"},503);
    return response({ok:true,slot,asset:next[slot]});
  }
  return {sendMedia,mediaRoute:route};
}

const {sendMedia,mediaRoute}=createMediaBridge({rows,insert,checkAdmin,response,up,apiHeaders,url,dbKey,wahaUrl,wahaKey});
const classify = (s: string) =>
  /(documento do carro|crlv|licenciamento|ve[ií]culo|carro fora do ano)/i.test(
    s,
  )
    ? "documento"
    : /(uber|cnh|habilita|ear|cadastro|motorista)/i.test(s)
      ? "uber"
      : "desconhecido";
const isLead = (s: string) =>
  /(uber|cnh|habilita|ear|cadastro|motorista|documento do carro|crlv|carro fora do ano|licenciamento|ve[ií]culo.{0,45}documento|documento.{0,45}ve[ií]culo|rodar|regulariz|or[cç]amento|pre[cç]o|\bREF\s*[:#-])/i.test(
    s,
  );
const issue = (s: string) =>
  /cnh vencid|cnh.*venceu/i.test(s)
    ? "CNH vencida"
    : /sem ear/i.test(s)
      ? "CNH sem EAR"
      : /n[aã]o tenho cnh/i.test(s)
        ? "Ainda não tem CNH"
        : /fora do ano/i.test(s)
          ? "Carro fora do ano"
          : /suspens|bloquead/i.test(s)
            ? "Cadastro suspenso"
            : /documento vencid|crlv vencid/i.test(s)
              ? "Documento vencido"
              : null;
const campaign = (s: string) =>
  s.match(/\b(?:REF|CAMP|CAMPANHA)[:#\s-]*([a-z0-9_-]{3,40})\b/i)?.[1] || null;

function normalizeConversation(value: unknown): string {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^\p{L}\p{N}@._+-]+/gu, " ").replace(/\s+/g, " ").trim();
}
function cleanDisplayName(value: unknown): string {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
}
function firstName(value: unknown): string {
  const raw = cleanDisplayName(value);
  if (!raw || /@|^\+?\d[\d\s()+-]*$/.test(raw)) return "";
  const norm = normalizeConversation(raw);
  const generic = new Set(["whatsapp", "whatsapp user", "user", "unknown", "unknown contact", "sem nome", "sem identificacao", "teste", "teste automatizado", "teste anonimo", "contato", "cliente", "eu", "eu pessoal", "atendimento"]);
  if (generic.has(norm)) return "";
  const token = raw.replace(/[^\p{L}\p{M}'’.-]+/gu, " ").trim().split(/\s+/)[0]?.replace(/[.]+$/,"") || "";
  if (!/^\p{L}[\p{L}\p{M}'’-]{0,23}$/u.test(token) || generic.has(normalizeConversation(token))) return "";
  return token.charAt(0).toLocaleUpperCase("pt-BR") + token.slice(1).toLocaleLowerCase("pt-BR");
}
function helloLine(name: string): string {
  return name ? "Oi, " + name + "! Tudo bem? 😊" : "Oi! Tudo bem? 😊";
}
function hasCampaignOrigin(message: string, payload: any): boolean {
  const normalized = normalizeConversation(message);
  // "source: app" is a WAHA transport label, NOT proof of a Meta advertisement.
  const fromMessage = Boolean(campaign(message)) ||
    /(?:vim|veio|cheguei|achei|encontrei|vi|cliquei|entrei).{0,28}(?:site|anuncio|campanha|publicidade|link patrocinado)/.test(normalized) ||
    /(?:pelo|do|no|atraves do|atraves da) (?:site|anuncio|link do site|anuncio do facebook|anuncio do instagram)/.test(normalized) ||
    /(?:meta ads|facebook ads|instagram ads|anuncio patrocinado|link patrocinado|utm_campaign|utm_source|ctwa_clid|fbclid)/.test(normalized);
  const referral = payload?.referral || payload?.referralInfo || payload?._data?.referral ||
    payload?._data?.message?.extendedTextMessage?.contextInfo?.externalAdReply ||
    payload?._data?.message?.imageMessage?.contextInfo?.externalAdReply ||
    payload?._data?.contextInfo?.externalAdReply;
  const fromReferral = Boolean(referral && typeof referral === "object" && (
    referral.source_type === "ad" || referral.sourceType === "ad" ||
    referral.source_id || referral.sourceId || referral.ctwa_clid ||
    referral.click_id || referral.ad_id || referral.adId ||
    referral.thumbnailUrl || referral.source_url
  ));
  return fromMessage || fromReferral;
}
function wasRecentlyContacted(contact: any, existed: boolean): boolean {
  const previous = existed ? Date.parse(String(contact?.last_message_at || "")) : NaN;
  return Number.isFinite(previous) && previous <= Date.now() &&
    (Date.now() - previous) < 10 * 24 * 60 * 60 * 1000;
}
type ReportedOrigin = "indicacao" | "site" | "instagram" | "facebook" | "youtube";
function recognizeReportedOrigin(value: string): ReportedOrigin | null {
  const normalized = normalizeConversation(value).replace(/[.!?]+$/,"").trim();
  const numeric = /^[1-5](?:[\s.)-]*)$/.exec(normalized);
  if (numeric) return (["indicacao","site","instagram","facebook","youtube"] as ReportedOrigin[])[Number(normalized[0])-1];
  const shortText = normalized.replace(/^(?:foi|vim|veio|cheguei|conheci|vi|achei|encontrei|pelo|pela|no|na|do|da|por|um|uma|de|o|a|video|atraves|atraves de|atraves do|atraves da|me indicaram|indicacao de)\s+/g,"").trim();
  if (normalized.length > 95) return null;
  if (/(?:indicacao|indicaram|indicou|amigo|amiga|conhecido|conhecida|recomendacao|recomendou|boca a boca)/.test(normalized)) return "indicacao";
  if (/(?:instagram|insta\b)/.test(normalized)) return "instagram";
  if (/(?:facebook|face\b)/.test(normalized)) return "facebook";
  if (/(?:youtube|you tube|yt\b)/.test(normalized)) return "youtube";
  if (/^(?:site|pagina|website|pagina na internet)$/.test(shortText) || /(?:no site|pelo site|do site|atraves do site)/.test(normalized)) return "site";
  return null;
}
const leadOriginQuestion = "Só pra confirmar: onde você conheceu a gente?\n\n1. Indicação\n2. Site\n3. Instagram\n4. Facebook\n5. Vídeo do YouTube\n\nPode responder com o número ou o nome. 😊";
function isGreetingOnly(value: string): boolean {
  return /^(?:oi+|ola+|opa|e ai|fala|bom dia|boa tarde|boa noite|tudo bem|como vai|oi tudo bem|ola tudo bem|oi bom dia|ola bom dia|oi boa tarde|ola boa tarde|oi boa noite|ola boa noite|bom dia tudo bem|boa tarde tudo bem|boa noite tudo bem)$/.test(normalizeConversation(value));
}
function isSmallTalkFollowup(value: string): boolean {
  return /^(?:tudo bem|e voce|e vc|tudo bem e voce|tudo certo e voce|bem e voce|tudo otimo e voce|tudo otimo|tudo certo|estou bem|to bem|tambem|obrigado|obrigada)$/.test(normalizeConversation(value));
}
function isCuriosity(value: string): boolean {
  return /(?:como funciona|me explica|quero saber mais|tenho interesse|mais informacoes|informacoes sobre|preciso de informacoes|quero ajuda|preciso de ajuda|quero atendimento|quero entender|me fala sobre|pode me explicar|qual o valor|quanto custa|quanto fica|preco|valor do servico|orcamento|quero contratar|quero fazer|quero abrir|abrir uma conta|fazer uma conta|quero uma conta|quero conta|preciso resolver)/.test(normalizeConversation(value));
}
function asksDocuments(value: string): boolean {
  return /(?:quais documentos|documentos preciso|o que preciso enviar|o que devo enviar|o que mando|me passa a lista|lista de documentos|quais sao os documentos|pode mandar os documentos|envia os documentos|manda os documentos|documentacao necessaria|quais sao os arquivos)/.test(normalizeConversation(value));
}
function asksPrice(value: string): boolean {
  return /(?:quanto custa|quanto fica|qual o valor|qual valor|preco|valor|custa quanto|forma de pagamento|como paga|pagamento|pix|parcel|mais barato|desconto)/.test(normalizeConversation(value));
}
function asksHow(value: string): boolean {
  return /(?:como funciona|como e o processo|me explica|o que esta incluso|o que inclui|como voces fazem|como e feito|como comeca|quais sao os passos)/.test(normalizeConversation(value));
}
function asksTiming(value: string): boolean {
  return /(?:quanto tempo|previsao|qual o prazo|prazo|demora|quando fica pronto|fica pronto hoje|e rapido|em quanto tempo)/.test(normalizeConversation(value));
}
function asksGuarantee(value: string): boolean {
  return /(?:garante|garantia|garantido|aprova|aprovacao|certeza que|vai dar certo|promete)/.test(normalizeConversation(value));
}
function asksDigitalCnh(value: string): boolean {
  return /(?:cnh digital|digital pode|pode ser digital|tenho digital|arquivo unico|frente e verso no mesmo arquivo|os dois lados no mesmo arquivo)/.test(normalizeConversation(value));
}
function isSimpleYes(value: string): boolean {
  return /^(?:sim|s|ok|okay|pode|pode ser|claro|beleza|fechado|certo|isso|bora|quero|vamos|concordo|de acordo|manda|pode mandar|ta bom|show|blz|perfeito|positivo)$/.test(normalizeConversation(value));
}
function isExplicitConsent(value: string): boolean {
  return /(?:quero seguir|pode seguir|pode continuar|vamos continuar|quero contratar|quero prosseguir|pode prosseguir|estou de acordo|concordo|aceito|vou enviar os documentos|envie a relacao de documentos|relacao de documentos|pode mandar|pode enviar|manda a lista|envia a lista|quero iniciar|pode iniciar|quero dar andamento|vamos em frente|pode tocar)/.test(normalizeConversation(value));
}
function isNegative(value: string): boolean {
  return /^(?:nao|agora nao|nao quero|depois|vou pensar|mais tarde|so estava perguntando|so queria saber)$/.test(normalizeConversation(value));
}
function isPriceObjection(value: string): boolean {
  return /(?:muito caro|achei caro|ta caro|caro demais|valor alto|fora do meu orcamento|nao tenho dinheiro|sem dinheiro|nao consigo pagar|nao posso pagar)/.test(normalizeConversation(value));
}
function accountAnswer(value: string): "new" | "existing" | null {
  const s = normalizeConversation(value);
  if (/(?:do zero|conta nova|nova conta|criar do zero|primeira vez|ainda nao tenho|nao tenho conta|nunca tive|fazer cadastro novo|cadastro novo)/.test(s)) return "new";
  if (/(?:ja tenho|conta existente|minha conta|bloquead|suspens|nao consigo entrar|login|recuper|desativad|foi recusad|ja estou cadastrad|conta parada)/.test(s)) return "existing";
  return null;
}

type ReplyIntent = "price" | "timing" | "guarantee" | "objection" | "documents" |
  "security" | "progress" | "payment" | "quality" | "support" | "eligibility" | "unlawful";
type ContextualAnswer = { kinds:ReplyIntent[]; text:string };
function replyVariant(options:readonly string[],seed:string):string {
  let hash=2166136261;
  for(const c of seed) hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
  return options[hash%options.length];
}
function contextualReply(message:string,lead:any,messageId:string):ContextualAnswer | null {
  const text=normalizeConversation(message);
  // Pure declarations such as "Conta Uber", "sim" and "vou enviar" must
  // continue through qualification/consent and document-state handlers.
  if(!text || isGreetingOnly(message) || isSmallTalkFollowup(message) ||
     isSimpleYes(message) || isNegative(message) || isExplicitConsent(message))
    return null;
  const isQuestion=/[?]/.test(message) ||
    /(?:quanto|qual|quando|como|pode|tem|voc[eê]s|preciso|quero saber|e possivel|da pra|sera que|gostaria de saber|mais informac)/.test(text);
  const unsafe=/(?:falsific|forj|fraud|adulter|documento falso|crlv falso|sem documento valido|burlar|enganar a uber|fake|alterar data do documento|driblar a verificacao)/.test(text);
  if(unsafe) return {kinds:["unlawful"],text:replyVariant([
    "Não fazemos documentos falsos nem burlamos verificações. Podemos analisar sua situação e orientar apenas caminhos regulares.",
    "Só trabalhamos com análise e procedimentos legais. Não podemos falsificar CRLV, EAR ou aprovação da plataforma.",
    "Essa alteração não pode ser feita de forma irregular. Podemos verificar quais documentos e requisitos oficiais estão pendentes."
  ],messageId+"unlawful")};
  const price=lead.service==="documento"?"R$ 150,00":lead.service==="uber"?"R$ 350,00":null;
  const kinds:ReplyIntent[]=[];
  if(isPriceObjection(message) || /(?:ta puxado|salgado|absurdo esse valor|muito dinheiro|achei salgado|valor e alto|carissimo|caro pra mim)/.test(text)) kinds.push("objection");
  else if(asksPrice(message) || /(?:qnt|qto|qt|quanto voces cobram|quanto vcs cobram|quanto vc cobra|tem algum custo|quanto pra|quanto e|investimento|valores|precos|custos|fica em quanto|preco final)/.test(text)) kinds.push("price");
  if(asksTiming(message) || /(?:hoje ainda|ate quando|pra ontem|urgente|urgencia|em minutos|em horas|em quantas horas|tempo pra liberar|tempo de analise)/.test(text)) kinds.push("timing");
  if(asksGuarantee(message) || /(?:garantem|certeza|se nao der certo|se der errado|vai funcionar|taxa de sucesso|certeza absoluta|garantido)/.test(text)) kinds.push("guarantee");
  if(asksDocuments(message) || /(?:precisa de rg|preciso de rg|lista de arquivos|papelada|copia da cnh|foto do crlv|precisa de selfie|preciso mandar selfie|quais arquivos|manda a lista|manda quais|documentos sao necessarios|preciso da cnh|quero enviar documentos|documentos necessarios)/.test(text)) kinds.push("documents");
  if(/(?:sigilo|seguro|meus dados|vazamento|lgpd|usam meus dados|dados pessoais|documento e seguro|pedem senha|precisa da senha|pedem codigo|codigo de verificacao|golpe|confiavel|privacidade)/.test(text)) kinds.push("security");
  if(/(?:como ta meu pedido|como esta meu pedido|tem novidade|como anda|em que fase|status|acompanhar|alguma novidade|ja terminou|ta pronto|ja ficou pronto|andamento|atualizacao do processo)/.test(text)) kinds.push("progress");
  if(/(?:pago depois|paga depois|so paga depois|pagamento na entrega|boleto|cartao|aceita pix|aceitam pix|parcelas|parcela|forma de pagar|como fazer pix|como pagar|adiantamento|sinal)/.test(text)) kinds.push("payment");
  if(/(?:foto borrada|foto ficou borrada|foto.*borrad|foto embacada|foto ruim|arquivo nao abre|arquivo nao carrega|nao consigo enviar|imagem ilegivel|imagem ficou ilegivel|print serve|imagem serve)/.test(text)) kinds.push("quality");
  if(/(?:atendente|falar com alguem|falar com uma pessoa|suporte humano|chamar o baiano)/.test(text)) kinds.push("support");
  if(/(?:sem ear|cnh vencida|cnh venceu|conta banida|conta bloqueada|conta uber.*bloquead|fora do ano|cadastro recusado|conta desativada|cnh provisoria|permissao para dirigir|requisitos da uber|aprovacao da uber)/.test(text) &&
      (isQuestion || /(?:minha|meu|estou|tenho|fui)/.test(text))) kinds.push("eligibility");
  if(kinds.length===0 || (!isQuestion && kinds.every(k=>k==="eligibility"))) return null;
  // One concise WhatsApp message answers at most three related questions.
  const distinct=kinds.slice(0,3);
  const parts:string[]=[];
  for(const kind of distinct){
    const variant=(options:string[])=>replyVariant(options,messageId+"|"+kind);
    switch(kind){
      case "objection":
        parts.push(variant([
          "Entendo que o valor pese. O atendimento inclui análise do seu caso, e você só paga após a entrega do serviço contratado.",
          "Compreendo a preocupação com o preço. Primeiro avaliamos a situação, e o pagamento é após a entrega, conforme combinado.",
          "Entendo. O valor cobre a análise do seu caso, e o pagamento só acontece após a entrega do serviço contratado."
        ]));break;
      case "price":
        parts.push(price?variant([
          "O valor é *"+price+"*, com pagamento após a entrega do serviço contratado.",
          "Para esse serviço, cobramos *"+price+"*. Você paga após a entrega, conforme combinado.",
          "Fica em *"+price+"*. O pagamento acontece depois da entrega do serviço."
        ]):"O atendimento Uber custa *R$ 350,00* e o de CRLV, *R$ 150,00*. Qual dos dois você precisa?");break;
      case "timing":
        parts.push(variant([
          "O prazo depende da demanda e da análise dos documentos. Confirmamos a previsão após conferir seu caso.",
          "Assim que avaliarmos os documentos, informamos o prazo estimado. Não consigo garantir horário antes dessa análise.",
          "A equipe verifica a situação e passa uma estimativa. O tempo pode variar conforme o caso."
        ]));break;
      case "guarantee":
        parts.push(variant([
          "Não prometemos aprovação ou desbloqueio automático. A viabilidade depende das regras aplicáveis e da análise dos documentos.",
          "A decisão final pode depender da Uber ou do órgão responsável. Podemos analisar o caso, mas não garantir o resultado.",
          "A análise é individual e não significa aprovação garantida. Vamos explicar o que é possível após conferir seu caso."
        ]));break;
      case "documents":
        parts.push(variant([
          "Para analisar, precisamos de:\n"+(lead.service==="documento"?"• CRLV":"• CNH frente e verso\n• CRLV\n• Selfie")+" \n• E-mail\nEnvie os arquivos legíveis aqui pelo WhatsApp.",
          "A documentação necessária é:\n"+(lead.service==="documento"?"• CRLV":"• CNH (frente e verso)\n• CRLV\n• Selfie")+" \n• E-mail\nPode mandar um por vez.",
          "Pode separar:\n"+(lead.service==="documento"?"• CRLV":"• CNH dos dois lados\n• CRLV\n• Selfie")+" \n• E-mail\nConferimos os arquivos antes de validar."
        ]).replace(/[ ]+\n/g,"\n"));break;
      case "security":
        parts.push(variant([
          "Seus documentos são usados para análise do atendimento. Não envie senhas, códigos de confirmação ou dados bancários.",
          "Envie apenas os arquivos necessários, e nunca senhas ou códigos recebidos por SMS/WhatsApp.",
          "A conferência exige documentos legíveis. Não precisamos da senha da sua conta nem de códigos de acesso."
        ]));break;
      case "progress":
        parts.push(variant([
          "Seu atendimento está na etapa de *"+(lead.conversation_state==="collecting_documents"?"recebimento dos documentos":lead.conversation_state==="awaiting_review"?"conferência dos arquivos":"análise inicial")+"*. Avisamos por aqui sobre os próximos passos.",
          "Por enquanto, estamos em *"+(lead.conversation_state==="awaiting_review"?"conferência":lead.conversation_state==="collecting_documents"?"coleta de documentos":"atendimento inicial")+"*. A equipe informa quando houver atualização.",
          "Consigo confirmar a etapa registrada, mas não uma conclusão ainda. Avisamos quando a análise avançar."
        ]));break;
      case "payment":
        parts.push(variant([
          "O pagamento é combinado para depois da entrega. A equipe confirma a forma de pagamento antes de concluir.",
          "Você não precisa pagar antes da entrega do serviço contratado. Confirme a forma de pagamento com o Baiano.",
          "O pagamento acontece após a entrega, conforme combinado. Para Pix ou parcelamento, precisamos confirmar a opção disponível."
        ]));break;
      case "quality":
        parts.push(variant([
          "Tente enviar uma foto nítida, com boa luz e todos os dados visíveis. Pode ser JPG, PNG ou PDF.",
          "Se a imagem ficou cortada ou desfocada, mande outra foto bem iluminada, mostrando o documento inteiro.",
          "Pode reenviar o arquivo legível por aqui. Se não conseguir anexar, nos avise para orientarmos a próxima etapa."
        ]));break;
      case "support":
        parts.push("Posso encaminhar para o Baiano continuar com você por aqui.");break;
      case "eligibility":
        parts.push(variant([
          "Entendi a situação. Precisamos conferir os requisitos da Uber e seus documentos antes de dizer o que é possível.",
          "Podemos avaliar o problema e orientar as etapas regulares. Sem análise, não é possível prometer aprovação ou liberação.",
          "Vamos verificar o que está pendente na conta e nos documentos. A aprovação depende dos critérios aplicáveis."
        ]));break;
      default:break;
    }
  }
  const ending=distinct.includes("eligibility") && lead.service==="uber" && lead.conversation_state==="qualify_uber"
    ? "\n\nA conta já existia ou você está criando uma nova?" : "";
  return {kinds:distinct,text:parts.join("\n\n")+ending+(kinds.length>3?"\n\nSe quiser, explico os outros pontos também.":"")};
}

function serviceDiscovery(lead: any, contact?: any): string {
  const name = firstName(contact?.display_name || lead?.display_name);
  return helloLine(name) + "\n\nClaro, te explico! 😊 Hoje atendemos duas situações:\n• Ajuda com conta/cadastro Uber — *R$ 350,00*\n• Serviço relacionado ao documento do carro (CRLV) — *R$ 150,00*\n\nQual delas você precisa resolver?";
}
function salesGreeting(_contact: any): string {
  return "Opa! Tudo bem? como posso ajudar?";
}
function salesOpening(lead: any, contact?: any): string {
  const name = firstName(contact?.display_name || lead?.display_name);
  const hello = helloLine(name);
  if (lead?.service === "documento") {
    if (lead?.issue) return hello + "\n\nEntendi, o ponto principal é *" + lead.issue + "*. O serviço relacionado ao CRLV custa *R$ 150,00*, e o pagamento é só após a entrega, conforme combinado. A viabilidade depende da análise do documento.\n\nQuer seguir com o atendimento? Se estiver de acordo, diga *pode seguir* e te passo os próximos passos.";
    return hello + "\n\nEntendi, você precisa de ajuda com o documento do carro (CRLV). O serviço custa *R$ 150,00*, e o pagamento é só após a entrega, conforme combinado.\n\nPra eu te orientar certinho: qual é a situação do documento? Você precisa resolver uma pendência ou tem outra dificuldade?";
  }
  if (lead?.issue) return hello + "\n\nEntendi, o ponto principal é *" + lead.issue + "*. O serviço de ajuda com o cadastro Uber custa *R$ 350,00*, e o pagamento é só após a entrega, conforme combinado. A análise depende dos documentos e dos requisitos aplicáveis; não prometemos aprovação automática.\n\nQuer seguir com o atendimento? Se estiver de acordo, diga *pode seguir* e te passo os próximos passos.";
  return hello + "\n\nEntendi, você quer ajuda com a conta/cadastro da Uber. O serviço custa *R$ 350,00*, e o pagamento é só após a entrega, conforme combinado.\n\nPra eu te orientar certinho: você está criando a conta do zero ou tentando resolver um problema em uma conta que já existe?";
}
function documentChecklist(lead: any, contact?: any): string {
  const name = firstName(contact?.display_name || lead?.display_name);
  const greeting = name ? "Perfeito, " + name + "!" : "Perfeito!";
  const list = lead?.service === "documento"
    ? "📄 Documento do carro (CRLV)"
    : "📄 CNH — frente e verso (a CNH digital pode vir em um único arquivo)\n📄 Documento do carro (CRLV)\n📄 Selfie com fundo branco";
  const phone = lead?.phone
    ? "📱 Telefone para contato: usamos este número do WhatsApp; avise se preferir outro."
    : "📱 Número de telefone para contato";
  return greeting + " Vamos começar pela análise do seu atendimento. 😊\n\nEnvie, por favor:\n" + list + "\n" + phone + "\n📧 E-mail\n\nPode mandar um item por vez. Vou confirmar cada recebimento e atualizar somente o que ainda faltar. Os documentos serão conferidos antes de qualquer validação.";
}
function qualificationResponse(lead: any, contact: any, message: string): { state: string; context: Record<string, unknown>; text: string } {
  const name = firstName(contact?.display_name || lead?.display_name);
  const address = name ? ", " + name : "";
  const s = normalizeConversation(message);
  const context = { ...(lead?.conversation_context || {}), last_customer_message: cleanDisplayName(message).slice(0, 240) };
  if (lead?.service === "uber") {
    const account = accountAnswer(message);
    const problem = issue(message);
    if (account || problem) {
      context.account_type = account || context.account_type || "not_specified";
      if (problem) context.reported_issue = problem;
      const detail = account === "new"
        ? "Entendi, você quer começar um cadastro do zero."
        : account === "existing"
          ? "Entendi, você precisa resolver uma situação de uma conta que já existe."
          : "Entendi, o ponto principal é " + problem + ".";
      return {
        state: "offer_consent", context,
        text: "Entendi" + address + "! " + detail + "\n\nO valor do serviço é *R$ 350,00*, com pagamento após a entrega. A análise depende dos seus documentos e dos requisitos aplicáveis; não prometemos aprovação automática.\n\nQuer seguir com o atendimento? Se estiver de acordo, diga *pode seguir* e eu te passo a lista de documentos.",
      };
    }
    return {
      state: "qualify_uber", context,
      text: "Claro" + address + "! 😊 Só preciso entender uma coisa para te orientar corretamente: você está criando a conta Uber do zero ou tentando resolver um problema em uma conta existente?",
    };
  }
  const vague = /^(?:sim|nao|nao sei|ok|okay|certo|beleza|tudo bem|oi|ola|bom dia|boa tarde|boa noite|quero|pode|me explica|como funciona)$/.test(s);
  if (!vague && s.length >= 3) {
    context.document_issue = cleanDisplayName(message).slice(0, 240);
    return {
      state: "offer_consent", context,
      text: "Entendi" + address + "! 😊 Vou considerar essa informação na análise do serviço relacionado ao CRLV. O valor é *R$ 150,00*, e o pagamento é só após a entrega.\n\nQuer seguir? Se estiver de acordo, diga *pode seguir* e te passo o que precisamos receber.",
    };
  }
  return {
    state: "qualify_documento", context,
    text: "Claro" + address + "! 😊 Para eu te orientar certinho, me conta qual é a pendência no documento do carro (CRLV).",
  };
}

function initial(lead: any) {
  const val = lead.service === "documento" ? "R$ 150,00" : "R$ 350,00";
  const status =
    lead.issue === "CNH vencida"
      ? "Vi que a sua *CNH está vencida* para trabalhar na Uber."
      : lead.issue
        ? `Vi que você precisa de ajuda com: *${lead.issue}*.`
        : "Vi que você precisa de ajuda com seu atendimento.";
  return `Olá, seja bem-vindo ao atendimento do *Baiano da 99*! 👋\n\n${status}\n\nO Baiano vai analisar a situação e buscar a solução para você voltar a trabalhar o mais rápido possível, respeitando os requisitos legais e da plataforma. 🚗\n\n💰 *Valor do serviço: ${val}*\n\n✅ Você só paga após a entrega do serviço contratado, conforme combinado.\n\nPara o Baiano analisar e dar continuidade no seu atendimento, precisamos dos seguintes documentos:\n\n${requiredFor(
    lead,
  )
    .map((kind) => "📄 *" + docs[kind] + "*")
    .join(
      "\n",
    )}\n📱 Número de telefone\n📧 E-mail\n\n*Se quiser fazer o serviço agora e estiver de acordo com o valor, envie os documentos solicitados.*\n\nVamos acompanhar seu atendimento até a conclusão!`;
}
const automationRules = [
  { id: "welcome_uber", title: "Abertura conversacional · conta Uber", trigger: "Primeiro contato identificado como cadastro Uber; pergunta se é conta nova ou existente", message: salesOpening({service:"uber"}).replace("Oi! Tudo bem? 😊","Oi{saudacao}! Tudo bem? 😊").replace("R$ 350,00","{valor}"), variables: ["nome","saudacao","valor"] },
  { id: "welcome_documento", title: "Abertura conversacional · documento do carro", trigger: "Primeiro contato identificado como CRLV; pergunta qual é a pendência", message: salesOpening({service:"documento"}).replace("Oi! Tudo bem? 😊","Oi{saudacao}! Tudo bem? 😊").replace("R$ 150,00","{valor}"), variables: ["nome","saudacao","valor"] },
  { id: "sales_greeting", title: "Saudação natural", trigger: "Cliente inicia com oi, olá ou bom dia sem indicar o serviço", message: "Opa! Tudo bem? como posso ajudar?", variables: [] },
  { id: "sales_discovery", title: "Descobrir serviço e qualificar interesse", trigger: "Cliente pede informações ou pergunta preço sem dizer qual serviço", message: "Oi{saudacao}! 😊 Hoje atendemos duas situações: conta/cadastro Uber ({valor_uber}) e serviço relacionado ao CRLV ({valor_crlv}). Qual delas você precisa resolver?", variables: ["nome","saudacao","valor_uber","valor_crlv"] },
  { id: "sales_qualify_answer", title: "Resposta contextual de qualificação", trigger: "Cliente responde se é cadastro novo ou conta existente, ou descreve a pendência", message: "Entendi, {nome}! Vou considerar isso na orientação. Quer seguir com o atendimento? Se estiver de acordo, diga pode seguir e eu te passo a lista de documentos.", variables: ["nome","valor"] },
  { id: "sales_offer", title: "Confirmar interesse antes de pedir documentos", trigger: "Cliente já esclareceu o que precisa; confirmar se quer seguir", message: "Quer seguir com o atendimento? Se estiver de acordo com o valor, diga pode seguir e eu te passo a lista de documentos.", variables: ["nome","valor"] },
  { id: "sales_documents", title: "Solicitar documentos após interesse confirmado", trigger: "Cliente pede a lista ou confirma que quer seguir", message: "Perfeito, {nome}! Envie os documentos solicitados, um por vez. Vou confirmar cada recebimento e atualizar somente o que ainda faltar.", variables: ["nome","documentos"] },
  { id: "sales_faq", title: "Explicar funcionamento, prazo e critérios", trigger: "Cliente pergunta como funciona, prazo, aprovação ou segurança", message: "O atendimento começa com o entendimento da sua situação, seguido do recebimento e conferência dos documentos necessários. A viabilidade depende dos documentos e dos requisitos aplicáveis; não prometemos aprovação automática.", variables: ["nome","valor"] },
  { id: "sales_smalltalk", title: "Manter conversa natural", trigger: "Cliente responde à saudação ou faz conversa breve antes de escolher serviço", message: "Tudo certo por aqui, obrigado por perguntar! 😊 Me conta: você precisa de ajuda com conta/cadastro Uber ou com o documento do carro (CRLV)?", variables: ["nome"] },
  { id: "guidance_missing", title: "Solicitar documentos e e-mail", trigger: "Cliente responde ou pergunta sobre documentos e ainda há itens faltando", message: "OK! ✅ Para continuar, ainda faltam:\n{faltantes}\nEnvie um item por vez. Vamos atualizando a lista conforme recebermos.", variables:["nome","faltantes"] },
  { id: "guidance_complete", title: "Itens recebidos", trigger: "Cliente pergunta sobre documentos e todos os itens já foram recebidos", message:"Recebemos os itens solicitados. O Baiano vai conferir os documentos antes de liberar a produção.", variables:["nome"] },
  { id: "price", title: "Informar preço", trigger: "Cliente pergunta valor, preço, quanto custa", message:"O valor do serviço é {valor}. O pagamento acontece após a entrega do serviço contratado. O Baiano vai analisar os documentos antes de confirmar a viabilidade.", variables:["nome","valor"] },
  { id: "human", title: "Atendimento humano", trigger: "Cliente pede atendente, pessoa ou atendimento humano; automação é pausada", message:"Certo! Vou encaminhar seu atendimento ao Baiano. Você pode continuar conversando por aqui.", variables:["nome"] },
  { id: "media_invalid", title: "Arquivo não aceito", trigger: "Anexo não pode ser registrado ou formato não é aceito", message:"Não conseguimos registrar esse arquivo. Envie uma imagem JPG/PNG/WebP ou PDF de até 12 MB.", variables:["nome"] },
  { id: "media_unknown", title: "Identificar tipo ou lado", trigger: "Bot recebe arquivo, mas não identifica com segurança", message:"Recebemos o arquivo, mas precisamos confirmar o tipo ou o lado. Informe se é CNH frente/verso, CRLV ou selfie. Se estiver desfocado, envie uma nova foto nítida.", variables:["nome"] },
  { id: "media_identified", title: "Documento identificado", trigger: "Leitura do anexo identifica o tipo do documento", message:"Recebemos o arquivo! ✅ Identificamos: {documento}. Vamos conferir a legibilidade e os dados antes de validar.", variables:["nome","documento"] },
  { id: "identify_reply", title: "Tipo informado pelo cliente", trigger: "Cliente identifica um único arquivo recente que estava sem tipo", message:"Obrigado! Identificamos o arquivo como {documento}. O Baiano ainda vai conferir a legibilidade e os dados.", variables:["nome","documento"] },
  { id: "identify_unmatched", title: "Associar identificação ao arquivo", trigger: "Cliente informa um tipo, mas não há um único arquivo recente para associar", message:"Envie o arquivo junto da identificação do tipo e do lado, para associarmos corretamente ao seu documento.", variables:["nome"] },
  { id: "proof_received", title: "Comprovante recebido", trigger: "Bot identifica comprovante enviado pelo cliente; pagamento permanece pendente", message:"Recebemos o comprovante. ✅ O Baiano vai conferir o valor, o destinatário e o recebimento. O pagamento continua pendente até a confirmação.", variables:["nome","valor"] },
  { id: "payment_pending", title: "Pagamento em conferência", trigger: "Cliente diz que pagou e já existe comprovante aguardando conferência", message:"O comprovante está aguardando conferência. O Baiano vai confirmar o recebimento; o pagamento continua pendente até essa confirmação.", variables:["nome","valor"] },
  { id: "payment_missing", title: "Solicitar comprovante", trigger: "Cliente diz que pagou, mas não enviou comprovante", message:"Recebemos sua informação sobre o pagamento. Envie o comprovante legível para o Baiano conferir. O pagamento continua pendente até a confirmação.", variables:["nome","valor"] },
  { id: "missing_manual", title: "Lembrete de itens faltantes", trigger: "Você clica em solicitar documentos faltantes no atendimento", message:"Recebemos os itens enviados. Para continuar, ainda precisamos de: {faltantes}. Se algum arquivo foi rejeitado, envie uma nova versão nítida.", variables:["nome","faltantes"] },
  { id: "production", title: "Produção iniciada", trigger: "Documentos e cadastro são conferidos; atendimento avança para produção", message:"Perfeito! ✅ Recebemos todos os seus documentos.\n\nVamos iniciar a produção do seu serviço o mais rápido possível. 🚗\n\nAssim que finalizarmos, vou te enviar uma mensagem para combinarmos a entrega do seu serviço por videochamada.\n\nObrigado pela confiança! 🤝", variables:["nome","valor"] },
  { id: "finish", title: "Serviço finalizado", trigger: "Você finaliza o serviço no Kanban; cliente é convidado para videochamada", message:"Olá! ✅ Seu serviço está finalizado. Por favor, ligue para o Baiano aqui pelo WhatsApp para combinar a entrega por videochamada. O pagamento acontece somente após a entrega, conforme combinado.", variables:["nome","valor"] },
];
async function automationSettings(req: Request) {
  if (!await checkAdmin(req)) return response({error:"Não autorizado"},401);
  if (!["GET","POST"].includes(req.method)) return response({error:"Método inválido"},405);
  const settings = (await rows("business_settings","?key=eq.automation_messages&select=value,updated_at"))[0];
  if (!settings) return response({error:"Configuração de automação indisponível"},503);
  if (req.method === "GET") return response({rules:automationRules.map(rule=>({...rule,message:settings.value[rule.id] || rule.message,default_message:rule.message,customized:typeof settings.value[rule.id]==="string"})),revision:settings.updated_at});
  const input = await req.json().catch(()=>null);
  const rule = automationRules.find(rule=>rule.id===input?.id);
  if (!rule) return response({error:"Gatilho inválido"},400);
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (input.reset !== true && (!message || message.length>3000)) return response({error:"Use uma mensagem de 1 a 3000 caracteres"},400);
  if (input.reset !== true && [...message.matchAll(/\{([^{}]+)\}/g)].some(match=>!rule.variables.includes(match[1]))) return response({error:"Use apenas os campos disponíveis neste gatilho"},400);
  if (input.revision !== settings.updated_at) return response({error:"A configuração mudou em outra janela. Atualize antes de salvar."},409);
  const next = {...settings.value};
  if (input.reset === true) delete next[rule.id]; else next[rule.id]=message;
  const revision = new Date().toISOString();
  const r = await fetch(up("business_settings","?key=eq.automation_messages&updated_at=eq."+encodeURIComponent(settings.updated_at)), {method:"PATCH",headers:{...apiHeaders(),Prefer:"return=representation"},body:JSON.stringify({value:next,updated_at:revision}),signal:AbortSignal.timeout(10000)});
  if (!r.ok) return response({error:"Não foi possível salvar a mensagem"},503);
  const saved=await r.json();
  if (!saved.length) return response({error:"A configuração mudou. Atualize antes de salvar."},409);
  return response({ok:true,revision:saved[0].updated_at});
}
function docType(s: string) {
  const x = s.toLowerCase();
  if (/comprovante|pix|pagamento/.test(x)) return "comprovante";
  // A caption mentioning both sides cannot prove their presence.
  if (/\bcnh\b/.test(x) && /frente/.test(x) && /verso|atr[aá]s/.test(x)) return "cnh_sem_lado";
  if (/cnh/.test(x) && /verso|atr[aá]s/.test(x)) return "cnh_verso";
  if (/cnh/.test(x) && /frente/.test(x)) return "cnh_frente";
  if (/\bcnh\b|carteira nacional de habilita/.test(x)) return "cnh_sem_lado";
  if (/rg/.test(x) && /verso|atr[aá]s/.test(x)) return "rg_verso";
  if (/rg/.test(x) && /frente/.test(x)) return "rg_frente";
  if (/crlv|documento do carro/.test(x)) return "crlv";
  if (/selfie/.test(x)) return "selfie";
  return "outro";
}

type OCRPart = { area?: string; text?: string; confidence?: number };
function normalizeOCR(value: string): string {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function markerCount(value: string, markers: RegExp[]): number {
  return markers.reduce((total, marker) => total + Number(marker.test(value)), 0);
}
/**
 * A composite CNH must have TWO separately OCR'd regions with complementary
 * front/back evidence. The filename, generic "frente e verso" caption or QR
 * alone are insufficient. No document validity is established here.
 */
function isCompleteCnh(regions: OCRPart[], text: string, hint: string): boolean {
  if (!Array.isArray(regions) || regions.length < 2) return false;
  const main = normalizeOCR(text + " " + hint);
  if (!/\bcnh\b|carteira nacional.{0,30}habilita/.test(main)) return false;
  const frontMarkers = [
    /\bnome\b/, /filiacao/, /data.{0,14}nascimento|nascimento/,
    /identidade|doc\.?\s*ident/, /naturalidade/
  ];
  const backMarkers = [
    /observacoes|restricoes/, /categoria.{0,18}habilit|categorias/,
    /codigo.{0,15}seguranca/, /\bqr\s*code\b|\bqrcode\b/,
    /assinatura.{0,22}(?:emissor|portador|condutor)/,
    /atividade.{0,15}remunerada/, /\brenach\b/
  ];
  const scores = regions
    .filter(r => Number(r.confidence || 0) >= 30 && String(r.text || "").trim().length >= 25)
    .map(r => {
      const v = normalizeOCR(String(r.text || ""));
      const area = String(r.area || "");
      return {
        front:markerCount(v, frontMarkers),
        back:markerCount(v,backMarkers),
        group:area.replace(/_[12]$/, ""),
        area
      };
    });
  // The regions must belong to opposite halves of the SAME page layout.
  // Mixing overlapping row and column crops could produce a false match.
  return scores.some((a,i) => a.front >= 2 && scores.some((b,j) =>
    i!==j && a.area!==b.area && a.group===b.group && b.back >= 2));
}
function hasDocKind(items: {kind: string;status?: string}[], kind: string, verifiedOnly=false): boolean {
  return items.some(d => (!verifiedOnly ? d.status !== "rejected" : d.status === "verified") &&
    (d.kind === kind || (
      d.kind === "cnh_completa" && (kind === "cnh_frente" || kind === "cnh_verso")
    )));
}

function identifyDocument(text: string, hint: string, confidence: number, method: string, regions: OCRPart[] = []) {
  const clean = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const supplied = docType(hint);
  if (isCompleteCnh(regions, text, hint)) {
    const scores = regions.map(r => Number(r.confidence || 0)).filter(n => n > 0);
    return {
      kind: "cnh_completa",
      identification_method: method === "pdf_text" || method === "pdf_ocr" ? "pdf_regions" : "image_regions",
      identification_confidence: Math.max(0, Math.min(100, Math.round(scores.reduce((a,b)=>a+b,0) / Math.max(1,scores.length)))),
      identification_note: "Duas regiões da CNH reconhecidas como frente e verso. Confira os dados e a autenticidade antes de validar.",
    };
  }
  let kind = "outro";
  let ambiguous = false;
  let note = "Não foi possível identificar com segurança. Confira o arquivo e informe o tipo.";
  if (confidence >= 55 && clean.trim().length >= 25) {
    const receipt = /comprovante|pix|transferencia/.test(clean) &&
      /valor|r\$/.test(clean) && /recebedor|destinatario|beneficiario|transacao|pagador/.test(clean);
    const charge = /qr code|copia e cola|cobranca|pague aqui/.test(clean) && !/concluid|realizad|efetuad|sucesso/.test(clean);
    const pending = /agendad|pendente|nao realizad|cancelad|falhou|saldo insuficiente/.test(clean) || charge;
    const vehicle = /crlv|licenciamento|certificado de registro/.test(clean) && /renavam|placa|veiculo/.test(clean);
    const license = /carteira nacional.{0,20}habilita|\bcnh\b/.test(clean);
    const identity = /registro geral|carteira de identidade|documento de identidade/.test(clean);
    const families = [receipt, vehicle, license, identity].filter(Boolean).length;
    if (receipt && !pending && families === 1) kind = "comprovante";
    else if (vehicle && families === 1) kind = "crlv";
    else if ((license || identity) && families === 1) {
      const family = license ? "cnh" : "rg";
      ambiguous = /frente/.test(clean) && /verso|atras/.test(clean);
      const side = /verso|atras/.test(clean) ? "verso" : /frente/.test(clean) ? "frente" : null;
      if (ambiguous) {
        if (license) kind = "cnh_sem_lado";
        note = "Há referências à frente e ao verso. Confirme qual lado foi enviado.";
      } else if (side) kind = family + "_" + side;
      else if (supplied.startsWith(family + "_") && supplied !== "cnh_sem_lado") kind = supplied;
      else if (license) { kind = "cnh_sem_lado"; note = "CNH reconhecida. Confirme se é frente ou verso."; }
      else note = "RG identificado. Confirme se é frente ou verso.";
    }
    if (pending && receipt) note = "Possível agendamento ou transferência pendente; não comprova pagamento realizado.";
    else if (families > 1) { ambiguous = true; note = "Mais de um tipo de documento encontrado; confira e separe os arquivos."; }
    if (kind !== "outro" && kind !== "cnh_sem_lado") note = kind === "comprovante"
      ? "Comprovante identificado pela leitura do arquivo. Confira valor, destinatário e recebimento; não confirma pagamento."
      : "Tipo sugerido pela leitura do arquivo. A legibilidade e a validade exigem conferência.";
  }
  if (kind === "outro" && supplied !== "outro" && !ambiguous && !/agendad|pendente|nao realizad|cancelad|falhou|saldo insuficiente|qr code|cobranca/.test(clean)) {
    kind = supplied;
    method = "filename_or_caption";
    note = supplied === "cnh_sem_lado"
      ? "O nome do arquivo ou a legenda indicam CNH. Confirme frente ou verso e confira o conteúdo."
      : "Tipo indicado pelo nome do arquivo ou legenda; conteúdo ainda exige conferência.";
  }
  return { kind, identification_method: method, identification_confidence: method === "caption" ? 0 : Math.max(0, Math.min(100, Math.round(confidence || 0))), identification_note: note };
}

/**
 * Keep the document checklist in sync after EVERY accepted attachment or
 * clarification. "Received" is not "verified": only a human may authorize
 * production. A single received cnh_completa covers both CNH intake slots.
 */
async function sendDocumentProgress(
  chat: string, lead: any, mid: string, confirmation: string, action = "progress",
) {
  const current = await rows("documents", "?lead_id=eq." + encodeURIComponent(lead.id) + "&select=kind,status");
  const remaining = requiredFor(lead).filter(kind => !hasDocKind(current, kind));
  const unresolvedCnh = current.some(d => d.kind === "cnh_sem_lado" && d.status !== "rejected");
  const missing: string[] = [];
  if (unresolvedCnh && remaining.includes("cnh_frente") && remaining.includes("cnh_verso")) {
    missing.push("• Confirme a CNH recebida: digital com os dois lados, apenas frente ou apenas verso.");
    for (const kind of remaining.filter(x => x !== "cnh_frente" && x !== "cnh_verso"))
      missing.push("• " + docs[kind]);
  } else {
    for (const kind of remaining) missing.push("• " + docs[kind]);
  }
  if (!lead.email) missing.push("• E-mail");
  const prefix = confirmation.trim() || "OK! ✅";
  const message = missing.length
    ? prefix + "\n\n*Para continuar, ainda faltam:*\n" +
      missing.join("\n") +
      "\n\nPode enviar um item por vez. Vou atualizar a lista a cada envio."
    : prefix + "\n\n✅ *Recebemos todos os itens solicitados!* O Baiano vai conferir os documentos antes de validar e avançar o atendimento.";
  await update("leads", lead.id, { conversation_state: missing.length ? "collecting_documents" : "awaiting_review" });
  await send(chat, message, lead, action + ":" + mid,
    missing.length ? "guidance_missing" : "guidance_complete",
    { faltantes: missing.join("\n") });
  if (!missing.length) {
    const audioSent = await sendMedia(chat,lead,"complete_audio","media:complete:"+lead.id);
    const context = lead.conversation_context || {};
    if (audioSent && !context.origin_confirmed && !context.origin_question_sent_at) {
      // The voice message must be delivered successfully before asking.
      // Message action_key prevents duplicate questions across webhook retries.
      await send(chat,leadOriginQuestion,lead,"origin:question:"+lead.id);
      const latest = (await rows("leads","?id=eq."+encodeURIComponent(lead.id)+"&select=conversation_context"))[0];
      await update("leads",lead.id,{
        conversation_context:{
          ...(latest?.conversation_context || context),
          origin_question_sent_at:new Date().toISOString(),
        }
      });
    }
  }
  return { missing };
}

async function mediaUpload(p: any, lead: any, msg: any, kind: string) {
  const mime = String(p.media?.mimetype || p.media?.mimeType || "");
  const media = String(p.media?.url || "");
  if (
    !media ||
    !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mime)
  )
    return false;
  let source: URL;
  try {
    source = new URL(media, wahaUrl);
  } catch {
    return false;
  }
  if (
    source.username ||
    source.password ||
    ![new URL(wahaUrl).origin, new URL(wahaPublicUrl).origin].includes(
      source.origin,
    )
  )
    return false;
  // Approved public media URLs are fetched over Railway's private network.
  const privateSource = new URL(wahaUrl);
  privateSource.pathname = source.pathname;
  privateSource.search = source.search;
  source = privateSource;
  const r = await fetch(source.toString(), {
    headers: { "X-Api-Key": wahaKey },
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw Error("Não foi possível baixar o anexo; será tentado novamente");
  const data = await r.arrayBuffer();
  if (data.byteLength > 12 * 1024 * 1024) return false;
  const ext =
    mime === "application/pdf"
      ? "pdf"
      : mime === "image/png"
        ? "png"
        : mime === "image/webp"
          ? "webp"
          : "jpg";
  if (
    (await rows("documents", "?message_id=eq." + msg.id + "&select=*")).length
  )
    return (await rows("documents", "?message_id=eq." + msg.id + "&select=*"))[0];
  const reader = (globalThis as any).BahianoReadDocument;
  const read = typeof reader === "function"
    ? await reader(data, mime, { filename: String(p.media?.filename || "") })
    : { text: "", confidence: 0, method: "unavailable" };
  const detected = identifyDocument(String(read.text || ""), String(p.body || "") + " " + String(p.media?.filename || ""), Number(read.confidence || 0), String(read.method || "unavailable"), Array.isArray(read.regions) ? read.regions : []);
  if (Number(read.pages) > 1) detected.identification_note += " A leitura automática considerou apenas a primeira página; confira todas as páginas.";
  // Preserve explicit selfie labels; OCR cannot establish identity or authenticity.
  if (kind === "selfie" && detected.kind === "outro") detected.kind = "selfie";
  const path = lead.id + "/" + msg.id + "." + ext;
  const x = await fetch(url + "/storage/v1/object/bahiano-documentos/" + path, {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      apikey: dbKey,
      Authorization: `Bearer ${dbKey}`,
      "Content-Type": mime,
      "x-upsert": "false",
    },
    body: data,
  });
  if (!x.ok && x.status !== 409) throw Error("Erro ao armazenar anexo");
  const document = await insert("documents", {
    lead_id: lead.id,
    message_id: msg.id,
    ...detected,
    storage_path: path,
    mime_type: mime,
    original_filename: String(p.media?.filename || "arquivo." + ext).slice(
      0,
      180,
    ),
    status: "received",
  });
  return document;
}
async function webhook(body: any) {
  if (body.session !== "default") return { ignored: true };
  if (body.event === "session.status") {
    console.info(
      "whatsapp session status",
      String(body.payload?.status || "unknown"),
    );
    return { ok: true };
  }
  if (!["message", "message.any"].includes(body.event))
    return { ignored: true };
  const p = body.payload || {};
  const raw = String(p.fromMe ? p.to : p.from || "");
  const mid = typeof p.id === "string" ? p.id : String(p.id?._serialized || "");
  if (!mid) return { ignored: true };
  let chat = raw;
  if (!p.fromMe && /^\d{1,24}@lid$/.test(raw)) {
    const key = p._data?.key;
    const alternate = String(key?.remoteJidAlt || "");
    if (key?.remoteJid === raw && /^\d{10,15}@s\.whatsapp\.net$/.test(alternate)) {
      chat = alternate.replace(/@s\.whatsapp\.net$/, "@c.us");
    } else if (key?.remoteJid === raw && /^\d{10,15}@c\.us$/.test(alternate)) {
      chat = alternate;
    } else {
      // Unknown LID: retain the webhook for retry instead of silently dropping it.
      let mapped = "";
      try {
        const response = await fetch(wahaUrl + "/api/default/lids/" + encodeURIComponent(raw), {
          headers: { "X-Api-Key": wahaKey }, signal: AbortSignal.timeout(5000),
        });
        if (response.ok) mapped = String((await response.json())?.pn || "");
      } catch { console.warn("WhatsApp LID lookup unavailable"); }
      chat = mapped.replace(/@s\.whatsapp\.net$/, "@c.us");
      if (!/^\d{10,15}@c\.us$/.test(chat))
        throw Error("WhatsApp Linked ID sem número verificado; processamento pendente");
    }
  } else if (!p.fromMe && /^\d{10,15}@s\.whatsapp\.net$/.test(raw)) {
    chat = raw.replace(/@s\.whatsapp\.net$/, "@c.us");
  }
  if (!/^\d{10,15}@c\.us$/.test(chat)) return { ignored: true };
  if (p.fromMe) {
    const contact = (
      await rows(
        "contacts",
        "?chat_id=eq." + encodeURIComponent(chat) + "&select=*",
      )
    )[0];
    if (!contact) return { ignored: true };
    const lead = (
      await rows("leads", "?contact_id=eq." + contact.id + "&select=*")
    )[0];
    const saved = await insert("messages", {
      contact_id: contact.id,
      lead_id: lead?.id || null,
      waha_id: mid,
      direction: "outgoing",
      kind: "text",
      body: String(p.body || "").slice(0, 3500),
    });
    return { ok: !!saved, duplicate: !saved };
  }
  const existing = (
    await rows("messages", `?waha_id=eq.${encodeURIComponent(mid)}&select=*`)
  )[0];
  if (existing?.processed_at) return { duplicate: true };
  let contact = (
    await rows("contacts", `?chat_id=eq.${encodeURIComponent(chat)}&select=*`)
  )[0];
  const previouslyKnownContact = Boolean(contact);
  const spokenInLastTenDays = wasRecentlyContacted(contact,previouslyKnownContact);
  const incomingDisplayName = cleanDisplayName(p.notifyName || p._data?.pushName || p._data?.notifyName || "");
  if (!contact)
    contact = await insert("contacts", {
      chat_id: chat,
      phone: chat.split("@")[0],
      display_name: incomingDisplayName || null,
      classification: "unknown",
    });
  if (!contact)
    contact = (
      await rows("contacts", `?chat_id=eq.${encodeURIComponent(chat)}&select=*`)
    )[0];
  if (!contact) throw Error("Contato não disponível");
  if (incomingDisplayName && (firstName(incomingDisplayName) || !contact.display_name) && incomingDisplayName !== contact.display_name) {
    const refreshed = await update("contacts", contact.id, { display_name: incomingDisplayName });
    contact = refreshed || { ...contact, display_name: incomingDisplayName };
  }
  const message = String(p.body || "").slice(0, 3500);
  const fromCampaign = hasCampaignOrigin(message,p);
  const code = campaign(message);
  let lead = (await rows("leads", `?contact_id=eq.${contact.id}&select=*`))[0];
  // Restore a returning archived contact to the Kanban while retaining history.
  if (lead?.conversation_context?.kanban_archived_at && contact.classification !== "personal") {
    const {kanban_archived_at: _archiveMarker, ...activeContext} = lead.conversation_context;
    const reopened = await update("leads",lead.id,{conversation_context:activeContext});
    lead = reopened || {...lead,conversation_context:activeContext};
  }
  if (lead && fromCampaign && (lead.source !== "site" || (code && !lead.campaign_code))) {
    const promoted = await update("leads",lead.id,{
      source:"site",
      campaign_code:code || lead.campaign_code || null,
      stage:lead.stage === "leads" ? "leads_campaign" : lead.stage,
    });
    lead = promoted || {...lead,source:"site",campaign_code:code || lead.campaign_code,stage:lead.stage === "leads" ? "leads_campaign" : lead.stage};
  }
  let serviceResolvedNow = false;
  if (lead && incomingDisplayName && firstName(incomingDisplayName) && lead.display_name !== incomingDisplayName) {
    const refreshedLead = await update("leads", lead.id, { display_name: incomingDisplayName });
    lead = refreshedLead || { ...lead, display_name: incomingDisplayName };
  }
  if (lead && lead.service !== "desconhecido") {
    const detectedSwitch = classify(message);
    const normalizedSwitch = normalizeConversation(message);
    const explicitSwitch = /(?:na verdade|quis dizer|me enganei|era sobre|em vez disso|preciso do crlv|documento do carro|licenciamento do carro|documento do veiculo|conta uber|cadastro uber|trabalhar de uber)/.test(normalizedSwitch);
    if (detectedSwitch !== "desconhecido" && detectedSwitch !== lead.service && explicitSwitch) {
      const switchedIssue = issue(message);
      const switchedState = switchedIssue ? "offer_consent" : detectedSwitch === "documento" ? "qualify_documento" : "qualify_uber";
      const refreshedLead = await update("leads", lead.id, {
        service: detectedSwitch,
        price_cents: detectedSwitch === "uber" ? 35000 : 15000,
        issue: switchedIssue,
        conversation_state: switchedState,
        conversation_context: { ...(lead.conversation_context || {}), service_switched_from: lead.service, service_switch_message: cleanDisplayName(message).slice(0, 240) },
      });
      lead = refreshedLead || { ...lead, service: detectedSwitch, price_cents: detectedSwitch === "uber" ? 35000 : 15000, issue: switchedIssue, conversation_state: switchedState };
      serviceResolvedNow = true;
    }
  }
  if (lead && lead.service === "desconhecido") {
    const resolved = classify(message);
    if (resolved !== "desconhecido") {
      const nextState = resolved === "uber" ? "qualify_uber" : "qualify_documento";
      const refreshedLead = await update("leads", lead.id, {
        service: resolved,
        price_cents: resolved === "uber" ? 35000 : 15000,
        issue: issue(message) || lead.issue || null,
        conversation_state: nextState,
        display_name: contact.display_name || lead.display_name,
      });
      lead = refreshedLead || { ...lead, service: resolved, price_cents: resolved === "uber" ? 35000 : 15000, conversation_state: nextState };
      serviceResolvedNow = true;
      await update("contacts", contact.id, { classification: "lead" });
      contact.classification = "lead";
    }
  }
  if (
    !lead &&
    contact.classification !== "personal" &&
    (!contact.manual_override || contact.classification === "lead") &&
    Boolean(message.trim() || p.hasMedia || fromCampaign)
  ) {
    const svc = classify(message);
    lead = await insert("leads", {
      contact_id: contact.id,
      display_name: contact.display_name,
      phone: contact.phone,
      service: svc,
      issue: issue(message),
      price_cents: svc === "uber" ? 35000 : svc === "documento" ? 15000 : 0,
      source: fromCampaign ? "site" : "whatsapp",
      campaign_code: code,
      stage: fromCampaign ? "leads_campaign" : "leads",
      conversation_state: svc === "uber" ? "qualify_uber" : svc === "documento" ? "qualify_documento" : "discover_service",
      conversation_context: {},
    });
    if (!lead)
      lead = (await rows("leads", `?contact_id=eq.${contact.id}&select=*`))[0];
    await update("contacts", contact.id, { classification: "lead" });
  }
  const msg =
    existing ||
    (await insert("messages", {
      lead_id: lead?.id || null,
      contact_id: contact.id,
      waha_id: mid,
      direction: "incoming",
      kind: p.hasMedia
        ? String(p.media?.mimetype || "").startsWith("image/")
          ? "image"
          : "document"
        : "text",
      body: message,
      media_mime: p.media?.mimetype || null,
    }));
  if (!msg) return { duplicate: true };
  await update("contacts", contact.id, {
    last_message_at: new Date().toISOString(),
  });
  if (contact.classification === "personal") return { classified: "personal" };
  // No repeat generic welcome for a person contacted in the previous 10 days.
  // Campaign leads and Uber-related conversations keep normal handling.
  // Ongoing CRLV workflows also remain available for substantive replies and files.
  const genericGreeting = isGreetingOnly(message) || isSmallTalkFollowup(message);
  const uberContext = !genericGreeting && (
    classify(message) === "uber" ||
    (lead?.service === "uber" && (
      Boolean(issue(message)) ||
      !["discover_service"].includes(String(lead.conversation_state || ""))
    ))
  );
  const ongoingCrlv = lead?.service === "documento" &&
    ["qualify_documento","offer_consent","collecting_documents","awaiting_review"].includes(
      String(lead.conversation_state || "")
    ) && !isGreetingOnly(message) && !isSmallTalkFollowup(message);
  if (spokenInLastTenDays && !fromCampaign && !uberContext && !ongoingCrlv) {
    return {lead_id:lead?.id || null,quiet_recent_contact:true};
  }
  if (!lead) {
    if (contact.manual_override || !(await botOn(chat))) return { classified: "unknown" };
    const outboundHistory = await rows("messages", "?contact_id=eq." + encodeURIComponent(contact.id) + "&direction=eq.outgoing&select=action_key,body,received_at");
    const hasGreeting = outboundHistory.some((item: any) => String(item.action_key || "").startsWith("sales:greeting:"));
    const hasDiscovery = outboundHistory.some((item: any) => String(item.action_key || "").startsWith("sales:discovery:"));
    const hasPrompt = hasGreeting || hasDiscovery;
    const pseudoLead = { id: null, contact_id: contact.id, display_name: contact.display_name, phone: contact.phone, service: "desconhecido", source: "whatsapp", price_cents: 0 };
    if (isGreetingOnly(message) && !hasGreeting) {
      await send(chat, salesGreeting(contact), pseudoLead, "sales:greeting:" + contact.id, "sales_greeting", { nome: firstName(contact.display_name) || "", saudacao: firstName(contact.display_name) ? ", " + firstName(contact.display_name) : "" });
      return { classified: "unknown", greeted: true };
    }
    if (hasPrompt && (isSimpleYes(message) || isNegative(message))) {
      await send(chat, "Claro! 😊 Só me diz qual atendimento você procura: conta/cadastro Uber (R$ 350,00) ou serviço relacionado ao documento do carro/CRLV (R$ 150,00)?", pseudoLead, "sales:discovery:" + mid, "sales_discovery", { nome: firstName(contact.display_name) || "", saudacao: firstName(contact.display_name) ? ", " + firstName(contact.display_name) : "", valor_uber: "R$ 350,00", valor_crlv: "R$ 150,00" });
      return { classified: "unknown", discovery: true };
    }
    if (hasPrompt && (isSmallTalkFollowup(message) || /^(?:e voce|e vc|tudo bem por aqui)$/.test(normalizeConversation(message)))) {
      await send(chat, "Tudo certo por aqui, obrigado por perguntar! 😊 Me conta: você precisa de ajuda com conta/cadastro Uber ou com o documento do carro (CRLV)?", pseudoLead, "sales:smalltalk:" + mid, "sales_smalltalk", { nome: firstName(contact.display_name) || "" });
      return { classified: "unknown", greeted: true };
    }
    if (isCuriosity(message) || p.hasMedia) {
      const text = p.hasMedia
        ? "Vi que você enviou um arquivo. Para eu associá-lo corretamente, primeiro me diga se o atendimento é sobre conta/cadastro Uber ou documento do carro (CRLV).\n\n" + serviceDiscovery(pseudoLead, contact)
        : serviceDiscovery(pseudoLead, contact);
      await send(chat, text, pseudoLead, "sales:discovery:" + mid, "sales_discovery", { nome: firstName(contact.display_name) || "", saudacao: firstName(contact.display_name) ? ", " + firstName(contact.display_name) : "", valor_uber: "R$ 350,00", valor_crlv: "R$ 150,00" });
      return { classified: "unknown", discovery: true };
    }
    return { classified: "unknown" };
  }
  // Capture the customer's answer to the one-time attribution question before
  // the document-state handlers can mistakenly interpret "3" as another request.
  if (!p.hasMedia && lead.conversation_context?.origin_question_sent_at &&
      !lead.conversation_context?.origin_confirmed &&
      !lead.automation_paused && await botOn(chat)) {
    const declared = recognizeReportedOrigin(message);
    if (declared) {
      const nextContext = {
        ...(lead.conversation_context || {}),
        origin_confirmed:declared,
        origin_confirmed_at:new Date().toISOString(),
        origin_confirmation_message:message.slice(0,120),
      };
      const patch:Record<string,unknown>={conversation_context:nextContext};
      // "site" is explicitly attributed. Organic Instagram/Facebook/YouTube
      // and referrals are not proof of Meta Ads and must not enter campaigns.
      if (declared==="site" && lead.source!=="site") {
        patch.source="site";
        if(lead.stage==="leads")patch.stage="leads_campaign";
      }
      const updated = await update("leads",lead.id,patch);
      lead=updated || {...lead,...patch};
      await send(chat,"Perfeito, obrigado! ✅",lead,"origin:thanks:"+lead.id);
      return {lead_id:lead.id,stage:lead.stage,reported_origin:declared};
    }
  }
  const now = new Date().toISOString();
  const proposed = docType(message);
  // A reply such as "frente" refers only to one recently received CNH
  // whose family is known but whose side remains unconfirmed.
  const reply = message.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/[.!?]+$/,"").replace(/\s+/g," ");
  const sideReply = !p.hasMedia
    ? /^(?:(?:e|eh|essa e|esse e|o arquivo e)\s+)?(?:a\s+)?(frente|verso|atras)(?:\s+da\s+cnh)?$/.exec(reply)?.[1] || ""
    : "";
  const digitalReply = !p.hasMedia && /^(?:(?:e|eh|isso e|ela e|a cnh e|o arquivo e)\s+)?(?:uma\s+)?(?:cnh\s+)?(?:digital|frente e verso|os dois lados|ambos os lados|com os dois lados|completo|completa)(?:\s+(?:com\s+)?(?:frente e verso|os dois lados))?$/.test(reply);
  const docTypeReply = !p.hasMedia && /^(?:(?:e|eh|isso e|esse e|essa e|o arquivo e|o documento e|a foto e)\s+)?(?:a\s+|o\s+)?(?:cnh(?: digital| frente| verso)?|carteira nacional de habilitacao(?: frente| verso)?|crlv|documento do carro|licenciamento|selfie|rg(?: frente| verso)?)(?: mesmo)?$/.test(reply);
  const email = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email)
    lead = await update("leads", lead.id, { email: email.slice(0, 254) });
  let uploaded: any = null;
  if (p.hasMedia) uploaded = await mediaUpload(p, lead, msg, proposed);
  const proof =
    lead.stage === "finalizados" &&
    uploaded?.kind === "comprovante";
  const paymentReported = lead.stage === "finalizados" && !p.hasMedia && /paguei|pix feito|pagamento realizado/i.test(message);
  if (proof)
    await update("leads", lead.id, {
      payment_status: "proof_received",
      proof_received_at: now,
    });
  if (p.hasMedia && !uploaded && !lead.automation_paused && await botOn(chat)) {
    await sendDocumentProgress(chat,lead,mid,"Não conseguimos registrar esse arquivo. Envie uma imagem JPG/PNG/WebP ou PDF de até 12 MB.","receipt");
    return {lead_id:lead.id,stage:lead.stage,attachment_received:false};
  }
  if (proof && !lead.automation_paused && await botOn(chat)) {
    await send(chat, "Recebemos o comprovante. ✅ O Baiano vai conferir o valor, o destinatário e o recebimento. O pagamento continua pendente até a confirmação.", lead, "proof-receipt:" + mid,"proof_received");
    return { lead_id: lead.id, stage: lead.stage, payment_status: "proof_received" };
  }
  if (paymentReported && !lead.automation_paused && await botOn(chat)) {
    const receivedProof = await rows("documents",`?lead_id=eq.${lead.id}&kind=eq.comprovante&status=neq.rejected&storage_path=not.is.null&limit=1`);
    await send(chat,receivedProof.length ? "O comprovante está aguardando conferência. O Baiano vai confirmar o recebimento; o pagamento continua pendente até essa confirmação." : "Recebemos sua informação sobre o pagamento. Envie o comprovante legível para o Baiano conferir. O pagamento continua pendente até a confirmação.",lead,"payment-report:"+mid,receivedProof.length ? "payment_pending" : "payment_missing");
    return {lead_id:lead.id,stage:lead.stage,payment_reported:true};
  }
  if (!lead.welcome_sent_at) {
    if (
      !lead.automation_paused &&
      ["leads", "leads_campaign"].includes(lead.stage) &&
      (await botOn(chat))
    ) {
      let state = "discover_service";
      let opening = serviceDiscovery(lead, contact);
      let template = "sales_discovery";
      if (lead.service === "desconhecido" &&
          (isGreetingOnly(message) || (!isCuriosity(message) && !isLead(message)))) {
        opening = salesGreeting(contact);
        template = "sales_greeting";
      } else if (lead.service !== "desconhecido") {
        if (asksDocuments(message)) {
          state = "collecting_documents";
          opening = documentChecklist(lead, contact);
          template = "sales_documents";
        } else {
          state = lead.issue ? "offer_consent" : lead.service === "documento" ? "qualify_documento" : "qualify_uber";
          opening = salesOpening(lead, contact);
          template = lead.service === "documento" ? "welcome_documento" : "welcome_uber";
        }
      }
      await send(chat, opening, lead, "welcome:" + lead.id, template, {
        nome: firstName(contact.display_name || lead.display_name) || "",
        saudacao: firstName(contact.display_name || lead.display_name) ? ", " + firstName(contact.display_name || lead.display_name) : "",
        valor: lead.service === "documento" ? "R$ 150,00" : "R$ 350,00",
        valor_uber: "R$ 350,00",
        valor_crlv: "R$ 150,00",
        documentos: requiredFor(lead).map((kind) => "• " + docs[kind]).join("\n"),
      });
      const updatedLead = await update("leads", lead.id, { welcome_sent_at: now, conversation_state: state });
      lead = updatedLead || { ...lead, welcome_sent_at: now, conversation_state: state };
    }
    return { lead_id: lead.id, stage: lead.stage, first: true };
  }
  const firstReply = !lead.first_reply_at &&
    ["leads", "leads_campaign"].includes(lead.stage);
  if (
    firstReply &&
    ["leads", "leads_campaign"].includes(lead.stage)
  ) {
    lead = await update("leads", lead.id, {
      first_reply_at: now,
      stage: "conversando",
    });
  }
  if (serviceResolvedNow && !lead.automation_paused && await botOn(chat)) {
    const state = lead.issue ? "offer_consent" : lead.service === "documento" ? "qualify_documento" : "qualify_uber";
    await send(chat, salesOpening(lead, contact), lead, "sales:resolved:" + mid,
      lead.service === "documento" ? "welcome_documento" : "welcome_uber",
      { nome: firstName(contact.display_name || lead.display_name) || "", saudacao: firstName(contact.display_name || lead.display_name) ? ", " + firstName(contact.display_name || lead.display_name) : "", valor: lead.service === "documento" ? "R$ 150,00" : "R$ 350,00" });
    await update("leads", lead.id, { conversation_state: state, welcome_sent_at: lead.welcome_sent_at || now });
    return { lead_id: lead.id, stage: lead.stage, service_resolved: true };
  }
  if (
    lead.automation_paused ||
    !(await botOn(chat)) ||
    ["producao", "finalizados", "pagos"].includes(lead.stage)
  )
    return { lead_id: lead.id, stage: lead.stage, paused: true };
  let state = String(lead.conversation_state || (lead.welcome_sent_at ? "collecting_documents" : "discover_service"));
  // An old conversation may already know the service but still be stuck in
  // discover_service (for example after a generic "Oi"). Never ask the
  // customer to pick Uber/CRLV again when the lead is already qualified.
  if (state === "discover_service" && lead.service !== "desconhecido" && !genericGreeting) {
    const statedIssue = issue(message);
    const resolvedIssue = statedIssue || lead.issue || null;
    const nextState = resolvedIssue ? "offer_consent"
      : lead.service === "uber" ? "qualify_uber" : "qualify_documento";
    const context = {
      ...(lead.conversation_context || {}),
      ...(statedIssue ? { reported_issue:statedIssue, last_customer_message:message.slice(0,240) } : {})
    };
    const refreshed = await update("leads",lead.id,{
      conversation_state:nextState,
      issue:resolvedIssue,
      conversation_context:context,
    });
    lead = refreshed || {...lead,conversation_state:nextState,issue:resolvedIssue,conversation_context:context};
    state = nextState;
    // If the message already states the problem, answer it specifically.
    // For direct questions, continue through normal FAQ/price logic below.
    if (!asksPrice(message) && !asksHow(message) && !asksTiming(message) &&
        !asksGuarantee(message) && !asksDocuments(message) &&
        !isExplicitConsent(message)) {
      await send(chat,salesOpening(lead,contact),lead,"sales:known-service:"+mid);
      return {lead_id:lead.id,stage:lead.stage,qualified_service:lead.service,reported_issue:resolvedIssue};
    }
  }
  const contextual = !p.hasMedia && !sideReply && !digitalReply && !docTypeReply ? contextualReply(message,lead,mid) : null;
  if (/falar com (?:um )?(?:atendente|pessoa|humano)|atendimento humano|falar com o baiano|quero falar com alguem/i.test(message)) {
    await update("leads", lead.id, { automation_paused: true, automation_pause_reason: "manual", conversation_state: "human_handoff" });
    await send(
      chat,
      "Claro! Vou encaminhar seu atendimento ao Baiano para continuar com você por aqui. 😊",
      lead,
      "human:" + mid,
      "human",
    );
  } else if (p.hasMedia) {
    if (uploaded && uploaded.kind !== "comprovante" && !["producao", "finalizados", "pagos"].includes(lead.stage)) {
      const updatedLead = await update("leads", lead.id, { conversation_state: "collecting_documents" });
      lead = updatedLead || { ...lead, conversation_state: "collecting_documents" };
    }
    const confirmation = !uploaded
      ? "Não consegui registrar esse arquivo"
      : uploaded.kind === "comprovante"
        ? "OK! ✅ Recebi o comprovante, mas ele ainda precisa de conferência."
        : uploaded.kind === "cnh_completa"
          ? "OK! ✅ Recebi sua CNH digital com frente e verso no mesmo arquivo. Ela ainda precisa de conferência."
        : uploaded.kind === "cnh_sem_lado"
          ? "OK! ✅ Recebi sua CNH. Ela é digital e contém frente e verso no mesmo arquivo, ou é apenas a frente/verso? Assim consigo identificar corretamente."
        : uploaded.kind === "outro"
          ? "Recebi o arquivo, mas ainda não consegui confirmar o tipo com segurança. Me diga se é CNH, CRLV ou selfie."
        : "OK! ✅ Recebi: *" + (docs[uploaded.kind] || uploaded.kind) + "*. Vou conferir a legibilidade antes de validar.";
    await sendDocumentProgress(chat,lead,mid,confirmation,"receipt");
  } else if (!p.hasMedia && (sideReply || digitalReply || docTypeReply)) {
    const pending = await rows("documents", "?lead_id=eq." + encodeURIComponent(lead.id) + "&status=eq.received&order=received_at.desc&limit=20");
    const candidates = pending.filter((d: any) =>
      digitalReply || sideReply ? d.kind === "cnh_sem_lado"
      : proposed.startsWith("cnh_") ? ["outro","cnh_sem_lado"].includes(d.kind)
      : d.kind === "outro");
    const resolvedKind = digitalReply ? "cnh_completa"
      : sideReply ? (sideReply === "frente" ? "cnh_frente" : "cnh_verso")
      : proposed;
    if (candidates.length === 1 &&
        Date.now() - Date.parse(candidates[0].received_at || 0) < 24 * 60 * 60 * 1000 &&
        (resolvedKind !== "cnh_sem_lado" || candidates[0].kind === "outro")) {
      const completeByClient = resolvedKind === "cnh_completa";
      await update("documents", candidates[0].id, {
        kind: resolvedKind,
        identification_method: "message_followup",
        identification_confidence: 0,
        identification_note: completeByClient
          ? "O cliente informou que o arquivo digital contém frente e verso. OCR não confirmou; revisão humana de ambas as faces obrigatória."
          : "Tipo ou lado informado pelo cliente. Exige conferência humana.",
      });
      await sendDocumentProgress(chat,lead,mid,
        "OK! ✅ Registramos o arquivo como *" + (docs[resolvedKind] || resolvedKind) +
        "*. O Baiano ainda vai conferir a legibilidade e os dados.",
        "identify-reply");
    } else {
      if (asksDigitalCnh(message) && !candidates.length) {
        if (state === "collecting_documents" || state === "awaiting_review") {
          await sendDocumentProgress(chat,lead,mid,
            "Sim! 😊 A CNH digital pode ser enviada em um único arquivo, desde que frente e verso estejam visíveis. Ela ainda será conferida.",
            "digital-cnh");
        } else {
          await send(chat,"Sim! 😊 A CNH digital pode ser enviada em um único arquivo, desde que frente e verso estejam visíveis. O arquivo será conferido antes de validar. Quer seguir com o atendimento?",lead,"digital-cnh:"+mid,"sales_faq");
        }
      } else {
        await sendDocumentProgress(chat,lead,mid,
          "Entendi! Não encontrei um único arquivo recente para associar essa informação. Envie o arquivo com uma legenda indicando o tipo.",
          "identify-reply");
      }
    }
  } else if (lead.service === "desconhecido" || state === "discover_service") {
    await update("leads", lead.id, { conversation_state: "discover_service" });
    const discoveryText = (isSimpleYes(message) || isNegative(message))
      ? "Claro! 😊 Só me diz qual atendimento você procura: conta/cadastro Uber (R$ 350,00) ou serviço relacionado ao documento do carro/CRLV (R$ 150,00)?"
      : serviceDiscovery(lead, contact);
    await send(chat, discoveryText, lead, "sales:discovery:" + mid, "sales_discovery", {
      nome: firstName(contact.display_name || lead.display_name) || "",
      saudacao: firstName(contact.display_name || lead.display_name) ? ", " + firstName(contact.display_name || lead.display_name) : "",
      valor_uber: "R$ 350,00",
      valor_crlv: "R$ 150,00",
    });
  } else if (contextual) {
    if (contextual.kinds.includes("support")) {
      await update("leads",lead.id,{automation_paused:true,automation_pause_reason:"manual",conversation_state:"human_handoff"});
    }
    await send(chat,contextual.text,lead,"contextual:"+mid);
  } else if (asksDocuments(message)) {
    const updatedLead = await update("leads", lead.id, { conversation_state: "collecting_documents" });
    lead = updatedLead || { ...lead, conversation_state: "collecting_documents" };
    await send(chat, documentChecklist(lead, contact), lead, "sales:documents:" + mid, "sales_documents", {
      nome: firstName(contact.display_name || lead.display_name) || "",
      documentos: requiredFor(lead).map((kind) => "• " + docs[kind]).join("\n"),
    });
  } else if (asksDigitalCnh(message)) {
    const answer = "Sim! 😊 A CNH digital pode ser enviada em um único arquivo, desde que frente e verso estejam visíveis. Ela será conferida antes de validar.";
    if (state === "collecting_documents" || state === "awaiting_review") {
      await sendDocumentProgress(chat,lead,mid,answer,"digital-cnh");
    } else {
      await send(chat,answer + "\n\nQuer que eu te passe os próximos passos?",lead,"digital-cnh:"+mid,"sales_faq");
    }
  } else if (asksGuarantee(message)) {
    const answer = "Prefiro ser transparente: não posso prometer aprovação automática. O Baiano confere os documentos e orienta o atendimento dentro dos requisitos aplicáveis da plataforma e da legislação.";
    if (state === "collecting_documents" || state === "awaiting_review") await sendDocumentProgress(chat,lead,mid,answer,"faq-guarantee");
    else await send(chat,answer + "\n\nQuer continuar com a análise do seu caso?",lead,"faq-guarantee:"+mid,"sales_faq");
  } else if (asksTiming(message)) {
    const answer = "O prazo depende da situação e da análise dos documentos. Não quero te prometer um prazo sem conferir seu caso primeiro.";
    if (state === "collecting_documents" || state === "awaiting_review") await sendDocumentProgress(chat,lead,mid,answer,"faq-timing");
    else await send(chat,answer + "\n\nSe me explicar sua situação, te oriento sobre o próximo passo.",lead,"faq-timing:"+mid,"sales_faq");
  } else if (/(?:meus documentos|privacidade|meus dados|e seguro|seguranca|confiavel|posso confiar|golpe|senha|codigo de verificacao)/.test(normalizeConversation(message))) {
    await send(chat,"Envie apenas os documentos necessários para este atendimento. Não envie senhas, códigos de verificação da Uber/WhatsApp nem dados bancários. Os arquivos serão conferidos antes de qualquer validação.",lead,"faq-privacy:"+mid,"sales_faq");
  } else if (asksHow(message)) {
    const answer = "Funciona assim: primeiro entendemos sua situação; depois você envia somente os documentos necessários; o Baiano confere os arquivos e avalia o próximo passo. A viabilidade depende dos documentos e dos requisitos aplicáveis, sem promessa de aprovação automática.";
    if (state === "collecting_documents" || state === "awaiting_review") await sendDocumentProgress(chat,lead,mid,answer,"faq-how");
    else {
      const next = state === "qualify_uber"
        ? "Pra eu te orientar certinho: você está criando a conta do zero ou tentando resolver um problema em uma conta existente?"
        : state === "qualify_documento"
          ? "Qual é a pendência no documento do carro (CRLV)?"
          : "Quer que eu te passe os próximos passos?";
      await send(chat,answer + "\n\n" + next,lead,"faq-how:"+mid,"sales_faq");
    }
  } else if (isPriceObjection(message)) {
    const price = lead.service === "documento" ? "R$ 150,00" : "R$ 350,00";
    const answer = "Entendo sua preocupação. O valor combinado é *" + price + "* e o pagamento acontece após a entrega. Não vou prometer desconto sem confirmação, mas posso esclarecer o que está incluído antes de você decidir.";
    if (state === "collecting_documents" || state === "awaiting_review") {
      await sendDocumentProgress(chat,lead,mid,answer,"price-objection");
    } else {
      await send(chat,answer + "\n\nQuer tirar alguma dúvida ou prefere pensar e retomar depois?",lead,"price-objection:"+mid,"sales_offer");
      if (lead.service === "uber") await sendMedia(chat,lead,"proof_1","media:proof:"+lead.id);
    }
  } else if (asksPrice(message)) {
    const price = lead.service === "documento" ? "R$ 150,00" : "R$ 350,00";
    const answer = "O valor do serviço é *" + price + "*. O pagamento acontece após a entrega, conforme combinado. A viabilidade é analisada antes de avançar.";
    if (state === "collecting_documents" || state === "awaiting_review") {
      await sendDocumentProgress(chat,lead,mid,answer,"price");
    } else {
      const next = state === "qualify_uber"
        ? "E para eu te orientar certinho: é uma conta nova ou uma conta que já existe?"
        : state === "qualify_documento"
          ? "Me conta qual é a pendência no CRLV."
          : "Quer seguir com o atendimento?";
      await send(chat,answer + "\n\n" + next,lead,"price:"+mid,"price");
    }
  } else if (state === "qualify_uber" || state === "qualify_documento") {
    if (email && !isExplicitConsent(message)) {
      await send(chat,"Obrigado! 😊 Registrei seu e-mail. " + (state === "qualify_uber"
        ? "Só me confirma: você está criando a conta Uber do zero ou resolvendo algo em uma conta existente?"
        : "Só me conta qual é a pendência no documento do carro (CRLV)."),
        lead,"sales:qualify-email:"+mid,"sales_qualify_answer");
    } else if (isExplicitConsent(message)) {
      const updatedLead = await update("leads", lead.id, { conversation_state: "collecting_documents" });
      lead = updatedLead || { ...lead, conversation_state: "collecting_documents" };
      await sendMedia(chat,lead,"intro_audio","media:intro:"+lead.id);
      await send(chat,documentChecklist(lead,contact),lead,"sales:documents:"+mid,"sales_documents",{
        nome:firstName(contact.display_name || lead.display_name) || "",
        documentos:requiredFor(lead).map((kind)=>"• "+docs[kind]).join("\n"),
      });
    } else {
      const answer = qualificationResponse(lead,contact,message);
      const updatedLead = await update("leads",lead.id,{
        conversation_state:answer.state,
        conversation_context:answer.context,
      });
      lead = updatedLead || {...lead,conversation_state:answer.state,conversation_context:answer.context};
      await send(chat,answer.text,lead,"sales:qualify:"+mid,"sales_qualify_answer",{
        nome:firstName(contact.display_name || lead.display_name) || "",
        valor:lead.service === "documento" ? "R$ 150,00" : "R$ 350,00",
      });
    }
  } else if (state === "offer_consent") {
    if (isExplicitConsent(message) || isSimpleYes(message)) {
      const updatedLead = await update("leads", lead.id, { conversation_state: "collecting_documents" });
      lead = updatedLead || { ...lead, conversation_state: "collecting_documents" };
      await sendMedia(chat,lead,"intro_audio","media:intro:"+lead.id);
      await send(chat,documentChecklist(lead,contact),lead,"sales:documents:"+mid,"sales_documents",{
        nome:firstName(contact.display_name || lead.display_name) || "",
        documentos:requiredFor(lead).map((kind)=>"• "+docs[kind]).join("\n"),
      });
    } else if (isNegative(message)) {
      await send(chat,"Sem problema! 😊 Fique à vontade. Se quiser, posso esclarecer alguma dúvida agora ou você pode retomar o atendimento quando preferir.",lead,"sales:decline:"+mid,"sales_offer");
    } else {
      await send(chat,"Claro! 😊 Se estiver de acordo com o valor e quiser seguir, diga *pode seguir*. Aí eu te passo a lista de documentos.",lead,"sales:offer:"+mid,"sales_offer",{
        nome:firstName(contact.display_name || lead.display_name) || "",
        valor:lead.service === "documento" ? "R$ 150,00" : "R$ 350,00",
      });
    }
  } else if (state === "collecting_documents") {
    await sendDocumentProgress(chat,lead,mid,
      email ? "OK! ✅ Registrei seu e-mail." : "Entendi! 😊 Pode mandar os documentos um por vez. Vou confirmar cada recebimento e te dizer somente o que ainda falta.",
      "guidance");
  } else if (state === "awaiting_review") {
    await sendDocumentProgress(chat,lead,mid,"Recebemos os itens enviados. Vou conferir se continua tudo completo antes de avançar.","review-status");
  } else {
    await send(chat,serviceDiscovery(lead,contact),lead,"sales:discovery:"+mid,"sales_discovery",{
      nome:firstName(contact.display_name || lead.display_name) || "",
      saudacao:firstName(contact.display_name || lead.display_name) ? ", " + firstName(contact.display_name || lead.display_name) : "",
      valor_uber:"R$ 350,00",
      valor_crlv:"R$ 150,00",
    });
  }
  return { lead_id: lead.id, stage: lead.stage };
}
async function admin(req: Request, path: string) {
  const actor = await checkAdmin(req);
  if (!actor) return response({ error: "Não autorizado" }, 401);
  let data: any;
  try {
    data = await req.json();
  } catch {
    return response({ error: "JSON inválido" }, 400);
  }
  if (path === "/admin/classify") {
    const contactId = String(data.contact_id || "");
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        contactId,
      ) ||
      !["unknown", "personal", "lead"].includes(data.classification)
    )
      return response({ error: "Classificação inválida" }, 400);
    const contact = await getContact(contactId);
    if (!contact) return response({ error: "Contato não encontrado" }, 404);
    await update("contacts", contactId, {
      classification: data.classification,
      manual_override: true,
    });
    if (
      data.classification === "lead" &&
      !(await rows("leads", "?contact_id=eq." + contactId + "&select=id"))
        .length
    )
      await insert("leads", {
        contact_id: contactId,
        display_name: contact.display_name,
        phone: contact.phone,
        service: "desconhecido",
        price_cents: 0,
        source: "manual",
        stage: "leads",
      });
    return response({ ok: true });
  }
  const id = String(data.lead_id || "");
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  )
    return response({ error: "ID inválido" }, 400);
  const lead = await getLead(id);
  if (!lead) return response({ error: "Lead não encontrado" }, 404);
  const contact = await getContact(lead.contact_id);
  if (!contact) return response({ error: "Contato não encontrado" }, 409);
  if (path === "/admin/reanalyze-document") {
    const documentId = String(data.document_id || "");
    if (!/^[a-f0-9-]{36}$/i.test(documentId))
      return response({error:"Documento inválido"},400);
    const record = (await rows("documents", "?id=eq." + documentId + "&lead_id=eq." + id + "&select=*"))[0];
    if (!record) return response({error:"Documento não encontrado"},404);
    if (record.status !== "received")
      return response({error:"Apenas documentos aguardando conferência podem ser reanalisados"},409);
    const savedPath = String(record.storage_path || "");
    if (!savedPath.startsWith(id + "/") || !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(?:png|jpg|webp|pdf)$/i.test(savedPath))
      return response({error:"Caminho do anexo inválido"},409);
    const mime = String(record.mime_type || "");
    if (!["image/png","image/jpeg","image/webp","application/pdf"].includes(mime))
      return response({error:"Formato de anexo não suportado"},415);
    const reader = (globalThis as any).BahianoReadDocument;
    if (typeof reader !== "function")
      return response({error:"Leitor de documentos indisponível"},503);
    const safePath = savedPath.split("/").map(encodeURIComponent).join("/");
    const downloaded = await fetch(url + "/storage/v1/object/bahiano-documentos/" + safePath,{
      headers: {apikey:dbKey,Authorization:`Bearer ${dbKey}`},
      redirect:"error",signal:AbortSignal.timeout(10000),
    });
    if (!downloaded.ok) return response({error:"Não foi possível recuperar o anexo armazenado"},503);
    const bytes = await downloaded.arrayBuffer();
    if (bytes.byteLength > 12*1024*1024)
      return response({error:"Arquivo excede o limite de 12 MB"},413);
    const read = await reader(bytes,mime,{filename:String(record.original_filename || "")});
    if (["busy","timeout","unavailable","unreadable"].includes(String(read.method || "")))
      return response({error:"OCR indisponível no momento. Tente novamente."},503);
    const detected = identifyDocument(String(read.text || ""),String(record.original_filename || ""),
      Number(read.confidence || 0),String(read.method || ""),Array.isArray(read.regions)?read.regions:[]);
    // Never downgrade an existing known classification because of OCR noise.
    // A partial OCR reading must never override a human-reported combined CNH.
    // If the new analysis is inconclusive, preserve the original provenance.
    const inconclusive = detected.kind === "outro" ||
      (record.kind === "cnh_completa" && detected.kind !== "cnh_completa");
    const updatedKind = inconclusive ? record.kind : detected.kind;
    const changes: any = inconclusive ? {
      identification_note: String(record.identification_note || "") +
        " Reanálise não confirmou uma nova classificação; confira a imagem manualmente.",
      identification_method: record.identification_method,
      identification_confidence: record.identification_confidence,
    } : {
      identification_note: detected.identification_note,
      identification_method: detected.identification_method,
      identification_confidence: detected.identification_confidence,
    };
    if (updatedKind !== record.kind) changes.kind = updatedKind;
    await update("documents",documentId,changes);
    return response({ok:true,kind:updatedKind,confidence:changes.identification_confidence,
      note:changes.identification_note});
  }
  if (path === "/admin/document") {
    const documentId = String(data.document_id || "");
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        documentId,
      ) ||
      !["verified", "rejected", "received"].includes(data.status) ||
      ![
        "cnh_frente",
        "cnh_verso",
        "cnh_sem_lado",
        "cnh_completa",
        "rg_frente",
        "rg_verso",
        "crlv",
        "selfie",
        "comprovante",
        "outro",
      ].includes(data.kind)
    )
      return response({ error: "Documento inválido" }, 400);
    const document = (
      await rows(
        "documents",
        "?id=eq." + documentId + "&lead_id=eq." + id + "&select=*",
      )
    )[0];
    if (!document) return response({ error: "Documento não encontrado" }, 404);
    if (data.status === "verified" && ["outro","cnh_sem_lado"].includes(data.kind))
      return response(
        { error: "Identifique o documento antes de validar" },
        409,
      );
    await update("documents", documentId, {
      kind: data.kind,
      status: data.status,
      verified_at: data.status === "verified" ? new Date().toISOString() : null,
    });
    await insert("lead_activity", {
      lead_id: id,
      kind: "document_review",
      description: data.kind + ": " + data.status,
    });
    if (
      data.status === "verified" &&
      ["conversando", "leads", "leads_campaign"].includes(lead.stage) &&
      lead.service !== "desconhecido" &&
      lead.email &&
      lead.phone &&
      (await botOn(contact.chat_id))
    ) {
      const verified = await rows(
        "documents",
        "?lead_id=eq." + id + "&status=eq.verified&select=kind",
      );
      if (
        requiredFor(lead).every((kind) => hasDocKind(verified.map(d => ({...d,status:"verified"})),kind,true))
      )
        return admin(
          new Request(req.url, {
            method: "POST",
            headers: req.headers,
            body: JSON.stringify({ lead_id: id }),
          }),
          "/admin/production",
        );
    }
    return response({ ok: true });
  }
  if (path === "/admin/missing") {
    if (!["leads", "leads_campaign", "conversando"].includes(lead.stage))
      return response({ error: "Atendimento não está na coleta" }, 409);
    if (lead.service === "desconhecido")
      return response({ error: "Selecione o serviço primeiro" }, 409);
    const documentRows = await rows(
      "documents",
      "?lead_id=eq." + id + "&select=kind,status",
    );
    if (documentRows.some((d) => d.kind === "outro" && d.status !== "rejected"))
      return response(
        {
          error:
            "Classifique os arquivos recebidos antes de pedir novos documentos",
        },
        409,
      );
    const missing = requiredFor(lead)
      .filter(
        (kind) =>
          !hasDocKind(documentRows,kind),
      )
      .map((kind) => docs[kind]);
    if (!lead.email) missing.push("e-mail");
    if (!missing.length)
      return response(
        { error: "Todos os itens foram recebidos. Confira a documentação." },
        409,
      );
    if (Date.now() - new Date(contact.last_message_at || 0).getTime() < 30000)
      return response(
        {
          error:
            "Aguarde 30 segundos após o último envio para agrupar os arquivos",
        },
        409,
      );
    await send(
      contact.chat_id,
      "Recebemos os itens enviados. Para continuar, ainda precisamos de: " +
        missing.join(", ") +
        ". Se algum arquivo foi rejeitado, envie uma nova versão nítida.",
      lead,
      undefined,
      "missing_manual",
      {faltantes:missing.join(", ")},
    );
    return response({ ok: true, missing });
  }
  if (path === "/admin/pause") {
    await update("leads", id, { automation_paused: data.paused !== false, automation_pause_reason: data.paused !== false ? "manual" : null });
    return response({ ok: true });
  }
  if (path === "/admin/deliver") {
    if (lead.stage !== "finalizados")
      return response(
        { error: "Finalize o serviço antes de registrar a entrega" },
        409,
      );
    await update("leads", id, {
      delivered_at: lead.delivered_at || new Date().toISOString(),
    });
    await insert("lead_activity", {
      lead_id: id,
      kind: "delivered",
      description: "Entrega por videochamada confirmada",
    });
    return response({ ok: true });
  }
  if (path === "/admin/payment") {
    if (lead.stage !== "finalizados" || !lead.delivered_at)
      return response(
        { error: "Pagamento exige serviço finalizado e entregue" },
        409,
      );
    if (!["uber","documento"].includes(lead.service) || lead.price_cents !== (lead.service === "uber" ? 35000 : 15000)) return response({error:"Revise o serviço e o valor contratado antes de confirmar o pagamento"},409);
    await update("leads", id, {
      stage: "pagos",
      payment_status: "confirmed",
      paid_at: new Date().toISOString(),
      payment_confirmed_by: actor.id,
    });
    await insert("lead_activity", {
      lead_id: id,
      kind: "payment_confirmed",
      description: "Recebimento confirmado manualmente",
    });
    return response({ ok: true });
  }
  if (path === "/admin/details") {
    const changes: Record<string, unknown> = {};
    for (const field of ["email", "display_name", "notes"])
      if (typeof data[field] === "string")
        changes[field] = data[field]
          .trim()
          .slice(0, field === "notes" ? 3000 : 254);
    if (changes.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(changes.email))) return response({error:"Informe um e-mail válido para o cliente"},400);
    if (["uber", "documento"].includes(data.service)) {
      if (!["leads", "leads_campaign", "conversando"].includes(lead.stage))
        return response(
          { error: "O serviço não pode ser alterado após iniciar a produção" },
          409,
        );
      changes.service = data.service;
      changes.price_cents = data.service === "uber" ? 35000 : 15000;
    }
    await update("leads", id, changes);
    return response({ ok: true });
  }
  if (path === "/admin/send") {
    const content = String(data.text || "")
      .trim()
      .slice(0, 3000);
    if (!content) return response({ error: "Mensagem vazia" }, 400);
    await send(contact.chat_id, content, lead);
    await update("leads", id, { automation_paused: true, automation_pause_reason: "manual" });
    return response({ ok: true });
  }
  if (path === "/admin/production") {
    if (!["conversando", "leads", "leads_campaign"].includes(lead.stage))
      return response({ error: "Etapa incompatível" }, 409);
    const documentRows = await rows(
      "documents",
      `?lead_id=eq.${id}&status=eq.verified&select=kind`,
    );
    const verified = new Set(documentRows.map((x: any) => x.kind));
    if (lead.service === "desconhecido")
      return response(
        { error: "Identifique o serviço antes de iniciar a produção" },
        409,
      );
    if (!lead.email || !lead.phone || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email) || !/^\d{10,15}$/.test(String(lead.phone).replace(/\D/g,"")))
      return response({ error: "Telefone e e-mail válidos são obrigatórios" }, 409);
    const missing = requiredFor(lead).filter((x) => !hasDocKind([...verified].map(kind=>({kind,status:"verified"})),x,true));
    if (missing.length)
      return response(
        {
          error: "Faltam documentos verificados",
          missing: missing.map((x) => docs[x]),
        },
        409,
      );
    await send(
      contact.chat_id,
      "Perfeito! ✅ Recebemos todos os seus documentos.\n\nVamos iniciar a produção do seu serviço o mais rápido possível. 🚗\n\nAssim que finalizarmos, vou te enviar uma mensagem para combinarmos a entrega do seu serviço por videochamada.\n\nObrigado pela confiança! 🤝",
      lead,
      "production:" + lead.id,
      "production",
    );
    await update("leads", id, {
      stage: "producao",
      documents_complete_at: new Date().toISOString(),
      automation_paused: true,
      automation_pause_reason: "production",
    });
    await insert("lead_activity", {
      lead_id: id,
      kind: "documents_complete",
      description: "Documentos revisados e produção liberada",
    });
    return response({ ok: true });
  }
  if (path === "/admin/finish") {
    if (lead.stage !== "producao")
      return response({ error: "Não está em Produção" }, 409);
    const reviewed = await rows("documents",`?lead_id=eq.${id}&status=eq.verified&select=kind`);
    if (!requiredFor(lead).every(kind=>hasDocKind(reviewed.map(document=>({...document,status:"verified"})),kind,true))) return response({error:"Revise os documentos obrigatórios antes de finalizar o serviço"},409);
    await send(
      contact.chat_id,
      "Olá! ✅ Seu serviço está finalizado. Por favor, ligue para o Baiano aqui pelo WhatsApp para combinar a entrega por videochamada. O pagamento acontece somente após a entrega, conforme combinado.",
      lead,
      "finish:" + lead.id,
      "finish",
    );
    await update("leads", id, {
      stage: "finalizados",
      finished_at: new Date().toISOString(),
      automation_paused: lead.automation_pause_reason === "production" ? false : lead.automation_paused,
      automation_pause_reason: lead.automation_pause_reason === "production" ? null : lead.automation_pause_reason,
    });
    await insert("lead_activity", {
      lead_id: id,
      kind: "finished",
      description: "Concluído, convite para videochamada enviado",
    });
    return response({ ok: true });
  }
  return response({ error: "Rota não encontrada" }, 404);
}
async function processWebhook(body: any) {
  const id =
    typeof body.payload?.id === "string"
      ? body.payload.id
      : body.payload?.id?._serialized;
  if (!id || !["message", "message.any"].includes(body.event))
    return webhook(body);
  const claim = await fetch(up("rpc/bahiano_claim_event"), {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: apiHeaders(),
    body: JSON.stringify({ p_event_id: id, p_payload: body }),
  });
  if (!claim.ok) throw Error("Fila de webhook indisponível");
  const status = await claim.json();
  if (status === "completed") return { duplicate: true };
  if (status === "busy") return { processing: true };
  async function settle(status: string) {
    const result = await fetch(
      up("webhook_events", "?event_id=eq." + encodeURIComponent(id)),
      {
        method: "PATCH",
        signal: AbortSignal.timeout(10000),
        headers: apiHeaders(),
        body: JSON.stringify({
          status,
          lease_until: null,
          updated_at: new Date().toISOString(),
          last_error: status === "failed" ? "processing_failed" : null,
        }),
      },
    );
    if (!result.ok) throw Error("Falha ao registrar processamento");
  }
  try {
    const result = await webhook(body);
    const message = (
      await rows(
        "messages",
        "?waha_id=eq." + encodeURIComponent(id) + "&select=id",
      )
    )[0];
    if (message)
      await update("messages", message.id, {
        processed_at: new Date().toISOString(),
      });
    await settle("completed");
    return result;
  } catch (error) {
    await settle("failed");
    throw error;
  }
}
async function retryEvents() {
  const now = new Date().toISOString();
  const events = await rows(
    "webhook_events",
    "?or=(status.eq.failed,and(status.eq.processing,lease_until.lt." +
      now +
      "))&order=created_at.asc&limit=20",
  );
  let succeeded = 0;
  for (const event of events) {
    try {
      await processWebhook(event.payload);
      succeeded++;
    } catch {
      console.error("webhook retry failed");
    }
  }
  return { retried: events.length, succeeded };
}
async function whatsapp(req: Request, path: string) {
  if (!(await checkAdmin(req)))
    return response({ error: "Não autorizado" }, 401);
  if (!wahaUrl || !wahaKey)
    return response({ error: "WAHA não configurado" }, 503);
  const qr = path === "/admin/whatsapp/qr";
  const restart = path === "/admin/whatsapp/restart";
  const connect = path === "/admin/whatsapp/connect";
  const disconnect = path === "/admin/whatsapp/disconnect";
  if (
    !qr &&
    !restart &&
    !connect &&
    !disconnect &&
    path !== "/admin/whatsapp/session"
  )
    return response({ error: "Rota não encontrada" }, 404);
  if (req.method !== (restart || connect || disconnect ? "POST" : "GET"))
    return response({ error: "Método inválido" }, 405);
  const call = (suffix: string, method = "GET", body?: unknown) =>
    fetch(wahaUrl + suffix, {
      method,
      headers: {
        "X-Api-Key": wahaKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    });
  if (connect || disconnect) {
    const current = await call("/api/sessions/default");
    if (current.status === 404) {
      if (disconnect)
        return response({
          name: "default",
          status: "STOPPED",
          connected: false,
        });
      const created = await call("/api/sessions", "POST", {
        name: "default",
        start: true,
      });
      if (!created.ok) throw Error("Falha ao criar sessão");
      return response({
        name: "default",
        status: "STARTING",
        connected: false,
      });
    }
    if (!current.ok) throw Error("Falha ao consultar sessão");
    const session = await current.json();
    if (
      connect &&
      [
        "WORKING",
        "SCAN_QR_CODE",
        "STARTING",
        "PASSKEY_REQUIRED",
        "PASSKEY_CONFIRMATION_REQUIRED",
      ].includes(session.status)
    )
      return response({
        name: "default",
        status: session.status,
        connected: session.status === "WORKING",
      });
    if (disconnect || (connect && session.status === "FAILED")) {
      // A FAILED NOWEB session can retain rejected credentials. A plain restart
      // reuses them and loops forever. Logout clears the old pairing so WAHA
      // can actually enter SCAN_QR_CODE and produce a fresh, scannable QR.
      const loggedOut = await call("/api/sessions/default/logout", "POST");
      if (!loggedOut.ok) throw Error("Falha ao limpar a autenticação antiga");
    }
    const changed = await call(
      "/api/sessions/default/" +
        (disconnect
          ? "stop"
          : session.status === "STOPPED"
            ? "start"
            : "restart"),
      "POST",
    );
    if (!changed.ok) throw Error("Falha ao alterar conexão");
    return response({
      name: "default",
      status: disconnect ? "STOPPED" : "STARTING",
      connected: false,
    });
  }
  const remote = await fetch(
    wahaUrl +
      (qr
        ? "/api/default/auth/qr?format=image"
        : restart
          ? "/api/sessions/default/restart"
          : "/api/sessions/default"),
    {
      method: restart ? "POST" : "GET",
      headers: {
        "X-Api-Key": wahaKey,
        Accept: qr ? "image/png" : "application/json",
      },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!remote.ok)
    return response(
      { error: "Sessão WhatsApp indisponível: " + remote.status },
      remote.status === 404 ? 404 : 503,
    );
  if (qr)
    return new Response(await remote.arrayBuffer(), {
      headers: {
        ...cors,
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  const session = await remote.json();
  return response({
    name: session.name,
    status: session.status,
    connected: session.status === "WORKING",
  });
}
Deno.serve(async (req) => {
  const p = new URL(req.url).pathname.replace(/^.*?\/bahiano-api(?=\/|$)/, "");
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (p === "/health")
    return response({
      ok: true,
      configured: !!(
        url &&
        dbKey &&
        publicKey &&
        wahaUrl &&
        wahaKey &&
        hookKey && E.get("BAHIANO_ADMIN_USER_ID")
      ),
      bot_enabled: await botOn().catch(() => false),
    });
  if (p === "/pixel.js" && req.method === "GET") {
    const script = (globalThis as any).BahianoPixelScript;
    try {return new Response(typeof script === "function" ? await script() : "/* indisponível */", {headers:{"content-type":"application/javascript", "cache-control":"no-store",...cors}});} catch {return new Response("/* Pixel temporariamente indisponível */",{status:503,headers:{"content-type":"application/javascript",...cors}});}
  }
  if (p === "/admin/media" || p === "/admin/media/upload") {
    try {return await mediaRoute(req,p);} catch {return response({error:"Falha na mídia da automação"},503);}
  }
  if (p === "/admin/automation") {
    try { return await automationSettings(req); } catch { return response({error:"Não foi possível acessar a automação"},503); }
  }
  if (p.startsWith("/admin/meta/")) {
    try {
      if(!await checkAdmin(req))return response({error:"Não autorizado"},401);
      const route=(globalThis as any).BahianoMetaRoute;
      if(typeof route!=="function")return response({error:"Integração indisponível"},503);
      const result=await route(req);return response(result,result.status||200);
    }catch{return response({error:"Não foi possível acessar a integração Meta"},503);}
  }
  if (p === "/internal/retry" && req.method === "POST") {
    if (
      !(await safeToken(
        req.headers.get("x-bahiano-webhook-token") || "",
        hookKey,
      ))
    )
      return response({ error: "Não autorizado" }, 401);
    try {
      return response(await retryEvents());
    } catch {
      return response({ error: "Fila indisponível" }, 503);
    }
  }
  if (
    p.startsWith("/admin/whatsapp/") &&
    ["GET", "POST"].includes(req.method)
  ) {
    try {
      return await whatsapp(req, p);
    } catch {
      return response({ error: "Não foi possível consultar o WhatsApp" }, 503);
    }
  }
  if (!url || !dbKey) return response({ error: "Banco indisponível" }, 503);
  if (p === "/webhook/waha" && req.method === "POST") {
    if (!hookKey) return response({ error: "Webhook não configurado" }, 503);
    if (
      !(await safeToken(
        req.headers.get("x-bahiano-webhook-token") || "",
        hookKey,
      ))
    )
      return response({ error: "Não autorizado" }, 401);
    try {
      return response(await processWebhook(await req.json()));
    } catch (e) {
      console.error(
        "bahiano-api request failed",
        e instanceof Error ? e.message : "unknown",
      );
      return response(
        { error: "Falha operacional. Consulte os logs do serviço." },
        500,
      );
    }
  }
  if (p.startsWith("/admin/") && req.method === "POST") {
    try {
      return await admin(req, p);
    } catch (e) {
      console.error(
        "bahiano-api request failed",
        e instanceof Error ? e.message : "unknown",
      );
      return response(
        { error: "Falha operacional. Consulte os logs do serviço." },
        500,
      );
    }
  }
  return response({ error: "Rota não encontrada" }, 404);
});
