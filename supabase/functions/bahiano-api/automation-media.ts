/**
 * Private automation media (audio and images), integrated with WAHA.
 * Original uploaded bytes stay unchanged in Supabase Storage.
 */
const BUCKET = "bahiano-automacao";
export const MEDIA_SLOTS = ["intro_audio","complete_audio","proof_1","proof_2","proof_3","proof_4","proof_5"];
export function createMediaBridge(deps:any) {
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
    let raw="";
    for(let i=0;i<bytes.length;i+=8192) raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const payload:Record<string,unknown>={
      session:"default",chatId,file:{mimetype:mime,filename:path.split("/").pop(),data:btoa(raw)}
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
      kind:voice?"audio":"image",body:slot,media_mime:mime,action_key:actionKey
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
