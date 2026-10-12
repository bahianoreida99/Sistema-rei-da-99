"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
type Rule = { id:string; title:string; trigger:string; message:string; default_message:string; variables:string[]; customized:boolean };
const sample: Record<string,string> = {nome:"Marina",valor:"R$ 350,00",faltantes:"• CNH frente\n• E-mail",documento:"CNH frente"};
export default function AutomationPanel() {
  const [rules,setRules]=useState<Rule[]>([]);
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
