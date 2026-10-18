"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
type Rule = { id:string; title:string; trigger:string; message:string; default_message:string; variables:string[]; customized:boolean };
type MediaKind = "audio" | "image";
type MediaSlot = "intro_audio" | "complete_audio" | "proof_1" | "proof_2" | "proof_3" | "proof_4" | "proof_5";
type BatchItem = { id:string; file:File; slot:MediaSlot | ""; status:"queued" | "uploading" | "done" | "error"; error?:string };
const mediaFields: ReadonlyArray<{slot:MediaSlot; title:string;kind:MediaKind}> = [
  {slot:"intro_audio",title:"Áudio de apresentação",kind:"audio"},
  {slot:"complete_audio",title:"Áudio de documentos recebidos",kind:"audio"},
  {slot:"proof_1",title:"Prova social 1",kind:"image"},
  {slot:"proof_2",title:"Prova social 2",kind:"image"},
  {slot:"proof_3",title:"Prova social 3",kind:"image"},
  {slot:"proof_4",title:"Prova social 4",kind:"image"},
  {slot:"proof_5",title:"Prova social 5",kind:"image"},
];
function mediaMime(file:File):string | null {
  const ext=file.name.toLowerCase().split(".").at(-1);
  return ({mp3:"audio/mpeg",ogg:"audio/ogg",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp"} as Record<string,string>)[ext || ""] || null;
}
function mediaKind(file:File):MediaKind | null {
  const mime=mediaMime(file);
  return mime ? (mime.startsWith("audio/") ? "audio" : "image") : null;
}
const sample: Record<string,string> = {nome:"Marina",valor:"R$ 350,00",faltantes:"• CNH frente\n• E-mail",documento:"CNH frente"};
export default function AutomationPanel() {
  const [rules,setRules]=useState<Rule[]>([]);
  const [media,setMedia]=useState<Record<string,{path?:string;mime_type?:string;enabled?:boolean}>>({});
  const [mediaBusy,setMediaBusy]=useState("");
  const [mediaError,setMediaError]=useState("");
  const loadMedia=useCallback(async()=>{
    const session=await supabase?.auth.getSession();
    if(!session?.data.session)throw Error("Entre novamente no painel");
    const r=await fetch(process.env.NEXT_PUBLIC_API_URL+"/admin/media",{
      headers:{authorization:"Bearer "+session.data.session.access_token},
      signal:AbortSignal.timeout(15000)
    });
    const data=await r.json();
    if(!r.ok)throw Error(data.error||"Falha ao carregar mídias");
    setMedia(data.assets||{});
  },[]);
  useEffect(()=>{void loadMedia().catch(()=>{});},[loadMedia]);
  const [batch,setBatch]=useState<BatchItem[]>([]);
  const [batchBusy,setBatchBusy]=useState(false);
  const [batchNotice,setBatchNotice]=useState("");
  const uploadFile=async(slot:string,file:File,token:string)=>{
    if(file.size>5*1024*1024)throw Error("O arquivo deve ter até 5 MB");
    const mime=mediaMime(file);
    const destination=mediaFields.find(entry=>entry.slot===slot);
    if(!mime || !destination || destination.kind!==mediaKind(file))
      throw Error("Formato ou destino incompatível");
    const r=await fetch(process.env.NEXT_PUBLIC_API_URL+"/admin/media/upload?slot="+slot,{
      method:"POST",headers:{authorization:"Bearer "+token,"Content-Type":mime},
      body:file,signal:AbortSignal.timeout(60000)
    });
    const data=await r.json();
    if(!r.ok)throw Error(data.error||"Não foi possível enviar");
  };
  const uploadMedia=async(slot:string,file:File)=>{
    setMediaBusy(slot);setMediaError("");
    try {
      const session=await supabase?.auth.getSession();
      if(!session?.data.session)throw Error("Entre novamente no painel");
      await uploadFile(slot,file,session.data.session.access_token);
      await loadMedia();
    }catch(e){setMediaError(e instanceof Error?e.message:"Falha no envio");}
    finally{setMediaBusy("");}
  };
  const queueFiles=(files:FileList | null)=>{
    if(!files?.length)return;
    const incoming=Array.from(files);
    const supported=incoming.filter(file=>mediaKind(file)!==null);
    const rejected=incoming.length-supported.length;
    setBatch(current=>{
      const reserved=new Set(current.filter(item=>item.status!=="done").map(item=>item.slot).filter(Boolean));
      const additions:BatchItem[]=supported.map(file=>{
        const kind=mediaKind(file);
        const slot=mediaFields.find(field=>field.kind===kind && !reserved.has(field.slot) && !media[field.slot]?.enabled)?.slot || "";
        if(slot)reserved.add(slot);
        return {id:crypto.randomUUID(),file,slot,status:"queued" as const};
      });
      return [...current.filter(item=>item.status!=="done"),...additions];
    });
    setBatchNotice(rejected ? rejected+" arquivo(s) ignorado(s): formato não aceito.": "");
  };
  const setBatchSlot=(id:string,slot:MediaSlot | "")=>{
    setBatch(items=>items.map(item=>item.id===id ? {...item,slot,status:"queued",error:undefined} : item));
    setBatchNotice("");
  };
  const sendBatch=async()=>{
    const queue=batch.filter(item=>item.status!=="done");
    if(!queue.length)return;
    const assignments=queue.map(item=>item.slot).filter(Boolean);
    if(queue.some(item=>!item.slot) || new Set(assignments).size!==assignments.length) {
      setBatchNotice("Escolha um destino diferente para cada arquivo antes de enviar.");
      return;
    }
    const replacements=queue.filter(item=>item.slot && media[item.slot]?.enabled);
    if(replacements.length && !confirm("Você selecionou "+replacements.length+" destino(s) que já têm mídia. Deseja substituir esses arquivos?"))return;
    setBatchBusy(true);setBatchNotice("");setMediaError("");
    let uploaded=0,failed=0;
    try {
      const session=await supabase?.auth.getSession();
      if(!session?.data.session)throw Error("Entre novamente no painel");
      const token=session.data.session.access_token;
      // A API updates one JSON configuration. Sequential requests prevent losing entries in concurrent PATCHes.
      for(const item of queue) {
        setBatch(items=>items.map(current=>current.id===item.id ? {...current,status:"uploading",error:undefined} : current));
        try {
          await uploadFile(item.slot,item.file,token);
          uploaded++;
          setBatch(items=>items.map(current=>current.id===item.id ? {...current,status:"done",error:undefined} : current));
        }catch(e) {
          failed++;
          const error=e instanceof Error ? e.message : "Falha no envio";
          setBatch(items=>items.map(current=>current.id===item.id ? {...current,status:"error",error} : current));
        }
      }
      await loadMedia();
      setBatchNotice(uploaded+" arquivo(s) enviado(s) com sucesso."+ (failed ? " "+failed+" falha(s); confira abaixo e tente novamente." : ""));
    }catch(e){setBatchNotice(e instanceof Error ? e.message : "Falha ao iniciar o lote");}
    finally{setBatchBusy(false);}
  };
  const queued=batch.filter(item=>item.status!=="done");
  const targets=queued.map(item=>item.slot).filter(Boolean);
  const duplicated=targets.length!==new Set(targets).size;
  const ready=queued.length>0 && queued.every(item=>Boolean(item.slot)) && !duplicated && !batchBusy && !mediaBusy;


  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const [revision,setRevision]=useState("");
  const [active,setActive]=useState("welcome_uber");
  const [search,setSearch]=useState("");
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const call=useCallback(async(body?:unknown)=>{
    const session=await supabase?.auth.getSession();
    if(!session?.data.session)throw Error("Entre novamente no painel");
    const r=await fetch(process.env.NEXT_PUBLIC_API_URL+"/admin/automation",{method:body?"POST":"GET",headers:{authorization:"Bearer "+session.data.session.access_token,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
    const data=await r.json();if(!r.ok)throw Error(data.error||"Não foi possível carregar a automação");return data;
  },[]);
  const refresh=useCallback(async()=>{const data=await call();setRules(data.rules);setRevision(data.revision);},[call]);
  useEffect(()=>{let alive=true;void call().then(data=>{if(alive){setRules(data.rules);setRevision(data.revision);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[call]);
  const dirty=rules.some(rule=>drafts[rule.id]!==undefined&&drafts[rule.id]!==rule.message);
  useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty)e.preventDefault();};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[dirty]);
  const save=async(rule:Rule,reset=false)=>{
    if(reset&&!confirm("Restaurar a mensagem padrão deste gatilho?"))return;
    setBusy(rule.id);setError("");setNotice("");
    try{
      const message=drafts[rule.id]??rule.message;
      const data=await call({id:rule.id,message,revision,reset});
      setRevision(data.revision);
      setRules(current=>current.map(item=>item.id===rule.id?{...item,message:reset?item.default_message:message.trim(),customized:!reset}:item));
      setDrafts(current=>{const next={...current};delete next[rule.id];return next;});
      setNotice("Mensagem salva. Os próximos envios deste gatilho usarão o novo texto.");
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar");}finally{setBusy("");}
  };
  const shown=rules.filter(rule=>(rule.title+" "+rule.trigger).toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")));
  return <div className="automationContent">
    <section className="panel"><h2>Mensagens da automação</h2><p className="muted">Escolha quando a mensagem é enviada, edite o texto e confira a prévia. Salvar altera os próximos envios; não dispara uma mensagem agora.</p><p className="muted">Os gatilhos acompanham as etapas do atendimento. A conferência dos documentos e a confirmação do pagamento continuam com você.</p><input className="automationSearch" aria-label="Buscar gatilho" placeholder="Buscar: boas-vindas, documentos, produção…" value={search} onChange={e=>setSearch(e.target.value)}/></section>
    <section className="panel"><h2>Áudios e imagens da automação</h2>
      <p className="muted">Envie o MP3 original sem alterações. O áudio de apresentação será enviado ao iniciar a coleta de documentos; o de conclusão, quando não houver pendências. Imagens ficam disponíveis como prova social. Limite: 5 MB por arquivo.</p>
      <div className="settingsForm" style={{marginBottom:16}}>
        <label htmlFor="batch-media-input"><strong>Enviar vários arquivos de uma vez</strong></label>
        <input id="batch-media-input" type="file" multiple
          accept=".mp3,.ogg,.jpg,.jpeg,.png,.webp,audio/mpeg,audio/ogg,image/jpeg,image/png,image/webp"
          disabled={batchBusy||Boolean(mediaBusy)}
          onChange={e=>{queueFiles(e.currentTarget.files);e.currentTarget.value="";}}/>
        <small>Selecione até 2 áudios e 5 imagens por lote. Confira o destino de cada arquivo antes de enviar. Não altera os arquivos originais.</small>
      </div>
      {batch.length>0&&<div style={{display:"grid",gap:10,marginBottom:16}}>
        <strong>Arquivos selecionados ({batch.length})</strong>
        {batch.map(item=><div key={item.id} style={{display:"grid",gap:6,padding:10,border:"1px solid var(--border-color, #bbb)",borderRadius:8}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
            <span style={{overflowWrap:"anywhere"}}>{item.file.name} ({(item.file.size/1024/1024).toFixed(2)} MB)</span>
            <span>{item.status==="done"?"Enviado":item.status==="uploading"?"Enviando…":item.status==="error"?"Falhou":"Pendente"}</span>
          </div>
          <label>Enviar para:
            <select value={item.slot} disabled={batchBusy||item.status==="done"}
              onChange={e=>setBatchSlot(item.id,e.target.value as MediaSlot | "")}>
              <option value="">Escolha o destino</option>
              {mediaFields.filter(field=>field.kind===mediaKind(item.file)).map(field=>
                <option value={field.slot} key={field.slot}>{field.title}{media[field.slot]?.enabled?" (já possui arquivo)":""}</option>)}
            </select>
          </label>
          {item.error&&<small role="alert" style={{color:"var(--error-color, #a32c2c)"}}>{item.error}</small>}
          {item.status!=="uploading"&&<button type="button" className="smallAction" disabled={batchBusy}
            onClick={()=>setBatch(items=>items.filter(x=>x.id!==item.id))}>Remover da lista</button>}
        </div>)}
        {duplicated&&<p role="alert" className="error">Há destinos repetidos. Escolha uma posição diferente para cada arquivo.</p>}
        {queued.some(item=>!item.slot)&&<p className="muted">Alguns arquivos ainda não têm destino. Se todos estiverem ocupados, você pode selecionar uma posição existente para substituir após confirmação.</p>}
        {batchNotice&&<p role="status">{batchNotice}</p>}
        <div className="automationActions">
          <button type="button" className="primaryBtn" disabled={!ready} onClick={()=>void sendBatch()}>
            {batchBusy?"Enviando arquivos…":"Enviar lote ("+queued.length+")"}
          </button>
          <button type="button" className="smallAction" disabled={batchBusy}
            onClick={()=>{setBatch([]);setBatchNotice("");}}>Limpar lista</button>
        </div>
      </div>}
      {mediaError&&<p role="alert" className="error">{mediaError}</p>}
      {([
        ["intro_audio","Áudio de apresentação"],
        ["complete_audio","Áudio de documentos recebidos"],
        ["proof_1","Prova social 1"],
        ["proof_2","Prova social 2"],
        ["proof_3","Prova social 3"],
        ["proof_4","Prova social 4"],
        ["proof_5","Prova social 5"]
      ] as const).map(([slot,title])=>
        <div className="settingsForm" key={slot}>
          <label>{title} {media[slot]?.enabled?"— armazenado":"— não enviado"}
            <input type="file" disabled={Boolean(mediaBusy)}
              accept={slot.endsWith("_audio")?".mp3,.ogg,audio/mpeg,audio/ogg":".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"}
              onChange={e=>{const f=e.currentTarget.files?.[0];if(f)void uploadMedia(slot,f);e.currentTarget.value="";}}/>
          </label>
          {mediaBusy===slot&&<small>Enviando arquivo…</small>}
        </div>
      )}
    </section>
    {error&&<div className="error" role="alert">{error}<button className="smallAction" disabled={Boolean(busy)} onClick={()=>void refresh().then(()=>setError("")).catch(e=>setError(e.message))}>Atualizar configuração</button></div>}
    {notice&&<div className="notice" role="status">{notice}</div>}
    {!rules.length&&!error&&<p role="status">Carregando mensagens…</p>}
    {rules.length>0&&!shown.length&&<p>Nenhum gatilho encontrado.</p>}
    {shown.map((rule,index)=>{
      const text=drafts[rule.id]??rule.message;const changed=text!==rule.message;
      const preview=text.replace(/\{(\w+)\}/g,(match,key)=>key==="valor"&&rule.id==="welcome_documento"?"R$ 150,00":sample[key]??match);
      return <section className="panel automationRule" key={rule.id}>
        <button className="automationHeading" aria-expanded={active===rule.id} onClick={()=>setActive(active===rule.id?"":rule.id)}><span><strong>{index+1}. {rule.title}</strong><small>Quando: {rule.trigger}</small></span><span>{changed?"Não salvo":rule.customized?"Personalizada":"Padrão"} {active===rule.id?"▴":"▾"}</span></button>
        {active===rule.id&&<div className="automationEditor"><div><label className="settingsForm">Mensagem<textarea aria-label={"Mensagem: "+rule.title} maxLength={3000} rows={10} value={text} onChange={e=>{setDrafts({...drafts,[rule.id]:e.target.value});setNotice("");}}/></label><div className="automationVariables"><small>Campos que são preenchidos automaticamente:</small>{rule.variables.map(variable=><button type="button" className="smallAction" key={variable} onClick={()=>setDrafts({...drafts,[rule.id]:text+" {"+variable+"}"})}>{"{"+variable+"}"}</button>)}</div><small>{text.length}/3000 caracteres</small><div className="automationActions"><button className="primaryBtn" disabled={Boolean(busy)||!text.trim()||!changed} onClick={()=>void save(rule)}>{busy===rule.id?"Salvando…":"Salvar mensagem"}</button><button className="smallAction" disabled={Boolean(busy)} onClick={()=>void save(rule,true)}>Restaurar padrão</button></div></div><div><h3>Prévia no WhatsApp</h3><p className="muted">Exemplo com dados fictícios.</p><div className="automationPreview">{preview}</div></div></div>}
      </section>;
    })}
  </div>;
}
