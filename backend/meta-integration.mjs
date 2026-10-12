import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

export function metaIntegration({ env = process.env, request = fetch } = {}) {
  const root = env.SUPABASE_URL;
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, "content-type": "application/json" };
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const key = () => { const value = Buffer.from(env.META_CONFIG_ENCRYPTION_KEY || "", "base64"); if (value.length !== 32) throw Error("Proteção do token não configurada no servidor");return value; };
  const encrypt = (text) => { const iv = randomBytes(12);const cipher = createCipheriv("aes-256-gcm",key(),iv);const data=Buffer.concat([cipher.update(text,"utf8"),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString("base64"); };
  const decrypt = (text) => { const data=Buffer.from(text,"base64");const cipher=createDecipheriv("aes-256-gcm",key(),data.subarray(0,12));cipher.setAuthTag(data.subarray(12,28));return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString("utf8"); };
  async function db(table,query="",method="GET",body) {
    const r=await request(root+"/rest/v1/"+table+query,{method,headers:{...headers,Prefer:"return=representation"},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error("Não foi possível acessar a integração Meta");return r.status===204?[]:r.json();
  }
  const config=async()=> (await db("meta_config","?id=eq.1"))[0];
  const publicConfig=(c)=>({pixel_id:c.pixel_id,website_url:c.website_url,enabled:c.enabled,has_token:Boolean(c.access_token_cipher),test_event_code:c.test_event_code,last_test_at:c.last_test_at,last_test_ok:c.last_test_ok});
  async function graph(c,event,test=false) {
    const r=await request("https://graph.facebook.com/"+(env.META_GRAPH_VERSION||"v26.0")+"/"+c.pixel_id+"/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({access_token:decrypt(c.access_token_cipher),data:[event],...(test&&c.test_event_code?{test_event_code:c.test_event_code}:{})}),signal:AbortSignal.timeout(8000)});
    const body=await r.json().catch(()=>({}));
    if(!r.ok||body.events_received!==1)throw Error("Meta recusou o evento (HTTP "+r.status+(body.error?.code?", código "+Number(body.error.code):"")+"). Confira o Pixel e as permissões do token.");
    return {events_received:body.events_received};
  }
  async function route(req) {
    const path=new URL(req.url).pathname;
    const c=await config();
    if(path.endsWith("/status")&&req.method==="GET") {
      const offset=Number(new URL(req.url).searchParams.get("offset")||0);
      if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)return {error:"Página inválida",status:400};
      const events=await db("meta_events","?select=event_id,event_name,event_time,status,attempts,last_error,sent_at&order=event_time.desc,event_id.desc&limit=50&offset="+offset);
      return {config:publicConfig(c),events};
    }
    if(req.method!=="POST")return {error:"Método não permitido",status:405};
    const input=await req.json().catch(()=>null);if(!input)return {error:"Dados inválidos",status:400};
    if(path.endsWith("/config")) {
      const pixel=String(input.pixel_id||"").trim();if(pixel&&!/^\d{5,30}$/.test(pixel))return {error:"ID do Pixel inválido",status:400};
      let site="";if(input.website_url){try{const u=new URL(input.website_url);if(u.protocol!=="https:"||u.username||u.password)throw Error();site=u.origin+u.pathname;}catch{return {error:"Use um endereço HTTPS válido para o site",status:400};}}
      const token=typeof input.token==="string"?input.token.trim():"";if(token.length>4096)return {error:"Token inválido",status:400};
      const code=String(input.test_event_code||"").trim();if(code.length>100||!/^[A-Za-z0-9_-]*$/.test(code))return {error:"Código de teste inválido",status:400};
      if(input.enabled&&(!pixel||!(token||c.access_token_cipher)))return {error:"Informe o Pixel e o token antes de ativar",status:400};
      const changed=pixel!==c.pixel_id||Boolean(token);
      const updated=(await db("meta_config","?id=eq.1","PATCH",{pixel_id:pixel,website_url:site,enabled:input.enabled===true,test_event_code:code,...(token?{access_token_cipher:encrypt(token)}:{}),...(changed?{last_test_ok:null,last_test_at:null}:{}),updated_at:new Date().toISOString()}))[0];
      if(changed&&input.enabled)await db("meta_events","?status=eq.failed","PATCH",{status:"pending",attempts:0,next_attempt_at:new Date().toISOString(),last_error:null});
      return {config:publicConfig(updated)};
    }
    if(path.endsWith("/test")) {
      if(!c.pixel_id||!c.access_token_cipher||!c.test_event_code)return {error:"Configure Pixel, token e código de Eventos de Teste da Meta",status:400};
      try{const result=await graph(c,{event_name:"MetaConnectionTest",event_time:Math.floor(Date.now()/1000),event_id:"test-"+randomUUID(),action_source:"system_generated",user_data:{external_id:[hash("bahiano-test")]},custom_data:{}},true);await db("meta_config","?id=eq.1","PATCH",{last_test_ok:true,last_test_at:new Date().toISOString()});return result;}catch(error){await db("meta_config","?id=eq.1","PATCH",{last_test_ok:false,last_test_at:new Date().toISOString()});return {error:error.message,status:502};}
    }
    return {error:"Rota não encontrada",status:404};
  }
  let sending=false;
  async function flush() {
    if(sending)return;sending=true;
    try {
      const c=await config();if(!c?.enabled||!c.pixel_id||!c.access_token_cipher)return;
      const events=await db("meta_events","?status=eq.pending&next_attempt_at=lte."+encodeURIComponent(new Date().toISOString())+"&order=event_time.asc&limit=10");
      for(const event of events){
        const current=await config();
        if(!current.enabled||current.updated_at!==c.updated_at)break;
        try{
          if(Date.now()-Date.parse(event.event_time)>7*86400000){await db("meta_events","?event_id=eq."+encodeURIComponent(event.event_id),"PATCH",{status:"ignored",last_error:"Evento com mais de 7 dias"});continue;}
          const lead=(await db("leads","?id=eq."+event.lead_id+"&select=id,phone,email,source,contact_id"))[0];const contact=lead&&(await db("contacts","?id=eq."+lead.contact_id+"&select=classification"))[0];
          if(!lead||lead.source==="demonstracao"||contact?.classification==="personal"){await db("meta_events","?event_id=eq."+encodeURIComponent(event.event_id),"PATCH",{status:"ignored"});continue;}
          const user={external_id:[hash(lead.id)]};const phone=String(lead.phone||"").replace(/\D/g,"");if(phone)user.ph=[hash(phone)];if(lead.email)user.em=[hash(lead.email.trim().toLowerCase())];
          await graph(c,{event_name:event.event_name,event_time:Math.floor(Date.parse(event.event_time)/1000),event_id:event.event_id,action_source:"chat",user_data:user,custom_data:event.custom_data});
          await db("meta_events","?event_id=eq."+encodeURIComponent(event.event_id),"PATCH",{status:"sent",sent_at:new Date().toISOString(),attempts:event.attempts+1,last_error:null});
          await db("meta_config","?id=eq.1&updated_at=eq."+encodeURIComponent(c.updated_at),"PATCH",{last_test_ok:true,last_test_at:new Date().toISOString()});
        }catch(error){const attempts=event.attempts+1;await db("meta_events","?event_id=eq."+encodeURIComponent(event.event_id),"PATCH",{attempts,status:attempts>=5?"failed":"pending",next_attempt_at:new Date(Date.now()+Math.min(3600,30*2**attempts)*1000).toISOString(),last_error:error.message.slice(0,250)});await db("meta_config","?id=eq.1&updated_at=eq."+encodeURIComponent(c.updated_at),"PATCH",{last_test_ok:false});}
      }
    }finally{sending=false;}
  }
  async function pixelScript() {
    const c=await config();if(!c?.enabled||!/^\d{5,30}$/.test(c.pixel_id)||!c.website_url)return "/* Pixel desativado ou sem site configurado */";
    return `(()=>{if(location.origin!==${JSON.stringify(new URL(c.website_url).origin)}||window.__bahianoPixel)return;window.__bahianoPixel=true;!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=true;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=true;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(c.pixel_id)});fbq('track','PageView',{}, {eventID:'page-'+crypto.randomUUID()});document.addEventListener('click',e=>{const a=e.target.closest?.('a[href]');if(a&&['wa.me','api.whatsapp.com'].includes(new URL(a.href).hostname))fbq('trackCustom','WhatsAppClick',{}, {eventID:'click-'+crypto.randomUUID()})})})();`;
  }
  return {route,flush,pixelScript};
}
