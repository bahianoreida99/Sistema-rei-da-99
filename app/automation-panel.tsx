"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
type Rule = { id:string; title:string; trigger:string; message:string; default_message:string; variables:string[]; customized:boolean };
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
  const uploadMedia=async(slot:string,file:File)=>{
    setMediaBusy(slot);setMediaError("");
    try {
      const session=await supabase?.auth.getSession();
      if(!session?.data.session)throw Error("Entre novamente no painel");
      if(file.size>5*1024*1024)throw Error("O arquivo deve ter até 5 MB");
      const r=await fetch(process.env.NEXT_PUBLIC_API_URL+"/admin/media/upload?slot="+slot,{
        method:"POST",headers:{
          authorization:"Bearer "+session.data.session.access_token,
          "Content-Type":file.type
        },body:file,signal:AbortSignal.timeout(60000)
      });
      const data=await r.json();
      if(!r.ok)throw Error(data.error||"Não foi possível enviar");
      await loadMedia();
    }catch(e){setMediaError(e instanceof Error?e.message:"Falha no envio");}
    finally{setMediaBusy("");}
  };

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
