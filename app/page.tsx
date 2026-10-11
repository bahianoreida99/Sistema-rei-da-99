"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  Archive,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  FileText,
  Filter,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Play,
  Search,
  Send,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  supabase,
  configured,
  ADMIN_EMAIL,
  stages,
  currency,
  type Lead,
  type Doc,
  type Msg,
} from "@/lib/supabase";
import { finance, type DocumentSplit } from "@/lib/finance";
import { zipSync } from "fflate";
import WhatsappPanel from "./whatsapp-panel";
import ServicePerformance from "./service-performance";

type Section = "dashboard" | "kanban";
const docLabels: Record<string, string> = {
  cnh_frente: "CNH — frente",
  cnh_verso: "CNH — verso",
  rg_frente: "RG — frente",
  rg_verso: "RG — verso",
  crlv: "Documento do carro",
  selfie: "Selfie",
  comprovante: "Comprovante",
  outro: "Outro documento",
};
const baseDocs = [
  "cnh_frente",
  "cnh_verso",
  "rg_frente",
  "rg_verso",
  "crlv",
  "selfie",
];
const lower = (s?: string | null) => String(s || "").toLowerCase();

export default function Home() {
  const [ready, setReady] = useState(false),
    [email, setEmail] = useState(ADMIN_EMAIL),
    [password, setPassword] = useState(""),
    [loginError, setLoginError] = useState(""),
    [authed, setAuthed] = useState(false);
  const [section, setSection] = useState<Section>("dashboard"),
    [leads, setLeads] = useState<Lead[]>([]),
    [documents, setDocuments] = useState<Doc[]>([]),
    [messages, setMessages] = useState<Msg[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("todos"),
    [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState("");
  const [documentSplit, setDocumentSplit] = useState<DocumentSplit>({
    bahiano_cents: 10000,
    campaign_cents: 5000,
  });
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  const active = leads.find((l) => l.id === selected) || null;
  const refresh = useCallback(async () => {
    if (!supabase) return;
    const [l, d, settings] = await Promise.all([
      supabase
        .from("leads")
        .select("*, contacts!inner(classification)")
        .neq("contacts.classification", "personal")
        .order("created_at", { ascending: false }),
      supabase
        .from("documents")
        .select("*")
        .order("received_at", { ascending: false }),
      supabase
        .from("business_settings")
        .select("key,value")
        .eq("key", "commission_documento"),
    ]);
    if (l.error) setNotice(l.error.message);
    else setLeads(l.data || []);
    for (const setting of settings.data || []) {
      if (setting.key === "commission_documento")
        setDocumentSplit(setting.value);
    }
    if (!d.error) setDocuments(d.data || []);
  }, []);
  const refreshMessages = useCallback(async (id: string) => {
    if (!supabase) return;
    const r = await supabase
      .from("messages")
      .select("*")
      .eq("lead_id", id)
      .order("received_at", { ascending: false })
      .limit(300);
    if (!r.error && selectedRef.current === id)
      setMessages([...(r.data || [])].reverse());
  }, []);
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      if (!supabase) {
        setReady(true);
        return;
      }
      const { data } = await supabase.auth.getUser();
      if (mounted) {
        setAuthed(
          lower(data.user?.email) === ADMIN_EMAIL &&
            Boolean(data.user?.email_confirmed_at),
        );
        setReady(true);
      }
    };
    void init();
    const subscription = supabase?.auth.onAuthStateChange((_e, session) => {
      if (mounted)
        setAuthed(
          lower(session?.user?.email) === ADMIN_EMAIL &&
            Boolean(session?.user?.email_confirmed_at),
        );
    });
    return () => {
      mounted = false;
      subscription?.data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!authed || !supabase) return;
    void refresh();
    let subscribed = false;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const catchUp = () => {
      void refresh();
      if (selectedRef.current) void refreshMessages(selectedRef.current);
    };
    const schedule = () => {
      if (pending) return;
      pending = setTimeout(() => { pending = undefined; catchUp(); }, 100);
    };
    const channel = supabase.channel("crm-updates");
    for (const table of ["leads", "contacts", "documents", "messages", "business_settings", "campaigns", "lead_activity"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, schedule);
    }
    channel.subscribe((status) => {
      subscribed = status === "SUBSCRIBED";
      if (subscribed) catchUp();
    });
    const id = setInterval(() => { if (!subscribed) catchUp(); }, 3000);
    const safety = setInterval(catchUp, 30000);
    window.addEventListener("focus", catchUp);
    window.addEventListener("online", catchUp);
    return () => {
      clearInterval(id);
      clearInterval(safety);
      clearTimeout(pending);
      window.removeEventListener("focus", catchUp);
      window.removeEventListener("online", catchUp);
      void supabase?.removeChannel(channel);
    };
  }, [authed, refresh, refreshMessages]);
  useEffect(() => {
    setMessages([]);
    if (selected) void refreshMessages(selected);
  }, [selected, refreshMessages]);
  const filtered = useMemo(
    () =>
      leads.filter(
        (l) =>
          (filter === "todos" || l.service === filter) &&
          [l.display_name, l.phone, l.issue, l.source].some((x) =>
            lower(x).includes(lower(query)),
          ),
      ),
    [leads, filter, query],
  );
  const docsFor = (id: string) => documents.filter((d) => d.lead_id === id);
  const totals = finance(leads, documentSplit);
  const paid = totals.paid;
  const unpaid = totals.awaitingPayment;
  const paidUber = paid.filter((l) => l.service === "uber");
  const revenue = totals.received;
  const campaignCommission = totals.commission;
  const bahianoKnown = totals.bahiano;
  const docPending = totals.documentSplitPending;
  const adminCall = async (
    action: string,
    l: Lead,
    extra: Record<string, unknown> = {},
  ) => {
    if (!supabase) throw Error("Login indisponível");
    const { data } = await supabase.auth.getSession();
    const backend = process.env.NEXT_PUBLIC_API_URL;
    if (!backend || !data.session) throw Error("API ou login não configurado");
    const r = await fetch(backend + "/admin/" + action, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + data.session.access_token,
      },
      body: JSON.stringify({ lead_id: l.id, ...extra }),
    });
    const result = await r.json();
    if (!r.ok) throw Error(result.error || "Falha na ação");
    await refresh();
  };
  const perform = async (
    action: string,
    l: Lead,
    extra: Record<string, unknown> = {},
  ) => {
    setBusy(l.id);
    try {
      await adminCall(action, l, extra);
      setNotice("Atualização concluída.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Falha na atualização");
    } finally {
      setBusy("");
    }
  };
  const changeLead = async (
    l: Lead,
    changes: Partial<Lead>,
    action: string,
  ) => {
    if (!supabase) return;
    setBusy(l.id);
    setNotice("");
    try {
      const { error } = await supabase
        .from("leads")
        .update(changes)
        .eq("id", l.id);
      if (error) throw error;
      await supabase
        .from("lead_activity")
        .insert({ lead_id: l.id, kind: action, description: action });
      await refresh();
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Erro ao atualizar o atendimento",
      );
    } finally {
      setBusy("");
    }
  };
  const onStart = async (l: Lead) => {
    setSelected(l.id);
    if (!l.production_started_at)
      await changeLead(
        l,
        {
          production_started_at: new Date().toISOString(),
          automation_paused: true,
        },
        "Produção iniciada",
      );
    else setNotice("Serviço carregado para produção");
  };
  const onFinish = async (l: Lead) => {
    if (
      !confirm(
        "Finalizar o serviço e enviar ao cliente a mensagem para combinar a videochamada?",
      )
    )
      return;
    setSelected(l.id);
    setBusy(l.id);
    try {
      const token = await supabase?.auth.getSession();
      const key = token?.data.session?.access_token;
      const backend = process.env.NEXT_PUBLIC_API_URL;
      if (!backend || !key) throw Error("API ainda não configurada");
      const r = await fetch(backend + "/admin/finish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + key,
        },
        body: JSON.stringify({ lead_id: l.id }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || "Erro ao finalizar");
      setNotice("Serviço finalizado e mensagem enviada ao WhatsApp");
      await refresh();
      await refreshMessages(l.id);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Falha ao finalizar");
    } finally {
      setBusy("");
    }
  };
  const confirmPayment = async (l: Lead) => {
    if (!l.delivered_at) {
      setNotice(
        "Confirme primeiro que a entrega por videochamada foi realizada.",
      );
      return;
    }
    if (
      !confirm(
        "O pagamento foi efetivamente recebido? Não confirme apenas com base no comprovante enviado.",
      )
    )
      return;
    await perform("payment", l);
  };
  const confirmDelivery = async (l: Lead) => {
    if (!confirm("O serviço foi entregue por videochamada?")) return;
    await perform("deliver", l);
  };
  const validateDocument = async (
    d: Doc,
    kind: string,
    status: "verified" | "rejected",
  ) => {
    const lead = leads.find((l) => l.id === d.lead_id);
    if (!lead) return;
    setBusy(d.id);
    try {
      await adminCall("document", lead, { document_id: d.id, kind, status });
      setNotice(
        status === "verified"
          ? "Documento validado."
          : "Documento rejeitado. Solicite novo envio pelo chat.",
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Falha na validação");
    } finally {
      setBusy("");
    }
  };
  const requiredDocs = (l: Lead) =>
    l.service === "desconhecido"
      ? []
      : l.service === "documento"
        ? ["rg_frente", "rg_verso", "crlv"]
        : baseDocs;
  const canGoProduction = (l: Lead) =>
    Boolean(l.email && l.phone) &&
    requiredDocs(l).length > 0 &&
    requiredDocs(l).every((kind) =>
      documents.some(
        (d) => d.lead_id === l.id && d.kind === kind && d.status === "verified",
      ),
    );
  const moveToProduction = async (l: Lead) => {
    if (!canGoProduction(l)) {
      setNotice(
        "Ainda faltam documentos verificados. Confira cada item antes de avançar.",
      );
      return;
    }
    if (!supabase) return;
    setBusy(l.id);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token,
        backend = process.env.NEXT_PUBLIC_API_URL;
      if (!token || !backend) throw Error("API ou login não configurado");
      const r = await fetch(backend + "/admin/production", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + token,
        },
        body: JSON.stringify({ lead_id: l.id }),
      });
      const result = await r.json();
      if (!r.ok)
        throw Error(
          result.error +
            (result.missing?.length ? " — " + result.missing.join(", ") : ""),
        );
      await refresh();
      setNotice(
        "Documentação validada. Cliente avisado pelo WhatsApp e encaminhado para Produção.",
      );
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Falha ao mover para produção",
      );
    } finally {
      setBusy("");
    }
  };
  const viewDoc = async (d: Doc) => {
    if (!supabase || !d.storage_path) return;
    const preview = window.open("about:blank", "_blank");
    const { data, error } = await supabase.storage
      .from("bahiano-documentos")
      .createSignedUrl(d.storage_path, 60);
    if (error || !data) {
      preview?.close();
      setNotice(error?.message || "Falha na visualização");
      return;
    }
    if (preview) {
      preview.opener = null;
      preview.location.href = data.signedUrl;
    } else setNotice("Permita abrir a visualização em uma nova janela.");
  };
  const downloadDoc = async (d: Doc) => {
    if (!supabase || !d.storage_path) return;
    const result = await supabase.storage
      .from("bahiano-documentos")
      .createSignedUrl(d.storage_path, 60, {
        download: `${d.kind}.${d.storage_path.split(".").pop() || "jpg"}`,
      });
    if (result.error) {
      setNotice(result.error.message);
      return;
    }
    window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
  };
  const downloadAll = async () => {
    if (!active || !supabase) return;
    setBusy("zip");
    try {
      const files: Record<string, Uint8Array> = {};
      const relevant = docsFor(active.id).filter(
        (x) => x.storage_path && x.status !== "rejected",
      );
      if (!relevant.length)
        throw Error("Nenhum documento disponível para download");
      for (const [i, d] of relevant.entries()) {
        const { data, error } = await supabase.storage
          .from("bahiano-documentos")
          .download(d.storage_path!);
        if (error || !data)
          throw new Error("Falha ao baixar " + (docLabels[d.kind] || d.kind));
        const extension =
          (d.storage_path || "")
            .split(".")
            .pop()
            ?.replace(/[^a-z0-9]/gi, "") || "jpg";
        files[String(i + 1).padStart(2, "0") + "_" + d.kind + "." + extension] =
          new Uint8Array(await data.arrayBuffer());
      }
      const zip = zipSync(files, { level: 0 });
      const blob = new Blob([zip as BlobPart], { type: "application/zip" });
      const u = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = u;
      link.download = "documentos_" + active.id + ".zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(u), 2000);
      setNotice("ZIP gerado com todos os documentos disponíveis.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Falha ao gerar ZIP");
    } finally {
      setBusy("");
    }
  };
  const send = async () => {
    if (!selected || !draft.trim() || !supabase) return;
    setBusy("send");
    try {
      const token = await supabase.auth.getSession();
      const backend = process.env.NEXT_PUBLIC_API_URL;
      if (!backend || !token.data.session?.access_token)
        throw Error("API ainda não configurada");
      const r = await fetch(backend + "/admin/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token.data.session.access_token,
        },
        body: JSON.stringify({ lead_id: selected, text: draft.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "Falha no envio");
      setDraft("");
      await refreshMessages(selected);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Falha no envio");
    } finally {
      setBusy("");
    }
  };
  const classifyContact = async (contactId: string, classification: string) => {
    if (!supabase) return;
    setBusy(contactId);
    try {
      const { data } = await supabase.auth.getSession();
      const backend = process.env.NEXT_PUBLIC_API_URL;
      if (!backend || !data.session)
        throw Error("API ou login não configurado");
      const response = await fetch(backend + "/admin/classify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + data.session.access_token,
        },
        body: JSON.stringify({ contact_id: contactId, classification }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Falha na classificação");
    } finally {
      setBusy("");
    }
  };
  const login = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError("");
    if (!supabase) return;
    const loginEmail = email.trim().toLowerCase();
    if (loginEmail !== ADMIN_EMAIL) {
      setLoginError("Acesso restrito ao administrador do Bahiano.");
      return;
    }
    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });
    if (error) {
      setLoginError(
        error.code === "email_not_confirmed"
          ? "Confirme seu e-mail pelo link enviado pelo Supabase antes de entrar."
          : error.code === "invalid_credentials"
            ? "E-mail ou senha incorretos. Confira os dados e tente novamente."
            : "Não foi possível entrar. Tente novamente em instantes.",
      );
    } else if (!data.user?.email_confirmed_at) {
      await supabase.auth.signOut();
      setLoginError(
        "Confirme seu e-mail pelo link enviado pelo Supabase antes de entrar.",
      );
    }
  };
  if (!ready) return <div className="fullCenter">Carregando painel...</div>;
  if (!configured)
    return (
      <div className="fullCenter">
        <section className="authPanel">
          <h1>Bahiano da 99</h1>
          <p>
            É necessário configurar as variáveis públicas do Supabase no painel
            de hospedagem.
          </p>
          <code>NEXT_PUBLIC_SUPABASE_URL</code>
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
        </section>
      </div>
    );
  if (!authed)
    return (
      <div className="fullCenter">
        <form className="authPanel" onSubmit={login}>
          <div className="brandMark">
            <span>♛</span>
            <strong>Bahiano da 99</strong>
          </div>
          <h2>Acesse sua central</h2>
          <p>Entre com o e-mail autorizado para gerenciar seus atendimentos.</p>
          <label>
            E-mail
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {loginError && <div className="error">{loginError}</div>}
          <button className="primaryBtn" type="submit">
            Entrar no painel <ArrowRight size={18} />
          </button>
        </form>
      </div>
    );
  return (
    <div className="appRoot">
      <aside className="sidebar">
        <div className="brandMark">
          <span>♛</span>
          <strong>Bahiano da 99</strong>
        </div>
        <nav>
          <button
            className={section === "dashboard" ? "navItem active" : "navItem"}
            onClick={() => setSection("dashboard")}
          >
            <LayoutDashboard size={19} /> Dashboard
          </button>
          <button
            className={section === "kanban" ? "navItem active" : "navItem"}
            onClick={() => setSection("kanban")}
          >
            <Archive size={19} /> Kanban
          </button>
        </nav>
        <div className="sidebarFoot">
          <div className="online">
            <MessageCircle size={20} /> Sistema de atendimento
          </div>
          <button
            className="navItem"
            onClick={async () => await supabase?.auth.signOut()}
          >
            <LogOut size={18} /> Sair
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="header">
          <div>
            <h1>
              {section === "dashboard" ? "Dashboard" : "Kanban de Atendimentos"}
            </h1>
            <p>
              {section === "dashboard"
                ? "Resumo dos seus serviços e recebimentos."
                : "Acompanhe seus clientes e produções em um só lugar."}
            </p>
          </div>
          {section === "kanban" && (
            <div className="headerTools">
              <div className="search">
                <Search size={18} />
                <input
                  placeholder="Buscar nome, número ou serviço"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <label className="selectWrapper">
                <Filter size={15} />
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="todos">Todos os serviços</option>
                  <option value="uber">Cadastro Uber</option>
                  <option value="documento">Documento do carro</option>
                </select>
                <ChevronDown size={14} />
              </label>
            </div>
          )}
        </header>
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}
        {section === "dashboard" ? (
          <div className="dashboard">
            <WhatsappPanel />
            <div className="metrics">
              <Metric
                icon={<Wallet />}
                label="Total recebido"
                value={currency(revenue)}
                detail={`${paid.length} pagamentos confirmados`}
              />
              <Metric
                icon={<CheckCircle2 />}
                label="Serviços pagos"
                value={`${paid.length}`}
                detail="Pagamentos conferidos"
              />
              <Metric
                icon={<Clock3 />}
                label="Aguardando pagamento"
                value={`${unpaid.length}`}
                detail={
                  currency(unpaid.reduce((s, l) => s + l.price_cents, 0)) +
                  " a receber"
                }
              />
              <Metric
                icon={<BarChart3 />}
                label="Parte do Bahiano"
                value={currency(bahianoKnown)}
                detail={
                  docPending
                    ? "Valores de documentos não incluídos no repasse"
                    : `${paidUber.length} serviços Uber pagos`
                }
              />
              <Metric
                icon={<Activity />}
                label="Sua comissão recebida"
                value={currency(campaignCommission)}
                detail="R$ 80 por Uber pago de origem rastreada"
              />
              <Metric
                icon={<BarChart3 />}
                label="Taxa de conversão"
                value={
                  (leads.length
                    ? (paid.length / leads.length) * 100
                    : 0
                  ).toFixed(1) + "%"
                }
                detail="Pagos sobre total de atendimentos"
              />
            </div>
            <ServicePerformance leads={leads} />
            <div className="dashPanels">
              <section className="panel">
                <h2>Etapas do atendimento</h2>
                {stages.map((s) => (
                  <div key={s.id} className="dashRow">
                    <span>{s.title}</span>
                    <strong>
                      {leads.filter((l) => l.stage === s.id).length}
                    </strong>
                  </div>
                ))}
              </section>
            </div>
          </div>
        ) : (
          <>
            <section className="kanbanBoard">
              {stages.map((stage) => (
                <div className="kanbanCol" key={stage.id}>
                  <div className="colHeader">
                    <div>
                      <h2>{stage.title}</h2>
                      <p>{stage.subtitle}</p>
                    </div>
                    <b>{filtered.filter((l) => l.stage === stage.id).length}</b>
                  </div>
                  <div className="colScroll">
                    {filtered
                      .filter((l) => l.stage === stage.id)
                      .map((l) => (
                        <article
                          key={l.id}
                          className={
                            "leadCard " + (selected === l.id ? "highlight" : "")
                          }
                          onClick={() => setSelected(l.id)}
                        >
                          <div className="leadTop">
                            <span className="avatar">
                              {(l.display_name || l.phone || "?")
                                .slice(0, 2)
                                .toUpperCase()}
                            </span>
                            <div className="leadBody">
                              <strong title={l.display_name || ""}>
                                {l.display_name ||
                                  l.phone ||
                                  "Contato sem nome"}
                              </strong>
                              <small>
                                {l.issue ||
                                  (l.service === "uber"
                                    ? "Cadastro Uber"
                                    : l.service === "documento"
                                      ? "Documento do carro"
                                      : "Serviço a identificar")}
                              </small>
                              <span
                                className={
                                  "pill " +
                                  (l.stage === "pagos"
                                    ? "green"
                                    : l.stage === "finalizados"
                                      ? "amber"
                                      : l.stage === "conversando"
                                        ? "blue"
                                        : "")
                                }
                              >
                                {l.stage === "pagos"
                                  ? "Pagamento confirmado"
                                  : l.stage === "finalizados"
                                    ? l.payment_status === "proof_received"
                                      ? "Comprovante recebido"
                                      : l.delivered_at
                                        ? "Aguardando pagamento"
                                        : "Aguardando entrega"
                                    : l.stage === "producao"
                                      ? "Documentos completos"
                                      : l.stage === "conversando"
                                        ? `${docsFor(l.id).length} documentos`
                                        : l.source}
                              </span>
                            </div>
                          </div>
                          {l.stage === "producao" && (
                            <button
                              className="startBtn"
                              disabled={busy === l.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                void onStart(l);
                              }}
                            >
                              <Play size={13} fill="currentColor" />{" "}
                              {l.production_started_at
                                ? "Continuar"
                                : "Começar"}
                            </button>
                          )}
                          {l.stage === "finalizados" && (
                            <button
                              className="smallAction"
                              onClick={(e) => {
                                e.stopPropagation();
                                void (l.delivered_at
                                  ? confirmPayment(l)
                                  : confirmDelivery(l));
                              }}
                            >
                              {l.delivered_at
                                ? "Confirmar pagamento"
                                : "Registrar entrega"}
                            </button>
                          )}
                        </article>
                      ))}
                    {filtered.filter((l) => l.stage === stage.id).length ===
                      0 && <p className="empty">Nenhum atendimento</p>}
                  </div>
                </div>
              ))}
            </section>
            <section className="workPanel">
              <div className="workTitle">
                <div>
                  <h2>Produção em andamento</h2>
                  <p>
                    {active
                      ? `Cliente selecionado: ${active.display_name || active.phone || "Contato"}`
                      : "Selecione um cliente na coluna Produção"}
                  </p>
                </div>
                {active?.stage === "producao" && (
                  <button
                    className="finishBtn"
                    disabled={busy === active.id}
                    onClick={() => void onFinish(active)}
                  >
                    <Check size={17} /> Finalizado
                  </button>
                )}
              </div>
              {active ? (
                <div className="workGrid">
                  <div className="chatBox">
                    <div className="chatHeader">
                      <span className="avatar">
                        {(active.display_name || "CL")
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                      <div>
                        <strong>
                          {active.display_name || active.phone || "Cliente"}
                        </strong>
                        <small>
                          {active.phone || "Telefone não informado"}
                        </small>
                      </div>
                      <span className="stateTag">
                        {stages.find((s) => s.id === active.stage)?.title}
                      </span>
                    </div>
                    <div className="chatScroll">
                      {messages.length ? (
                        messages.map((m) => (
                          <div
                            key={m.id}
                            className={
                              "bubble " +
                              (m.direction === "outgoing" ? "sent" : "received")
                            }
                          >
                            <span>
                              {m.body ||
                                (m.kind === "image"
                                  ? "📷 Imagem recebida"
                                  : m.kind === "document"
                                    ? "📎 Arquivo recebido"
                                    : "Mídia recebida")}
                            </span>
                            <small>
                              {new Date(m.received_at).toLocaleTimeString(
                                "pt-BR",
                                { hour: "2-digit", minute: "2-digit" },
                              )}
                            </small>
                          </div>
                        ))
                      ) : (
                        <p className="muted">Nenhuma mensagem registrada.</p>
                      )}
                    </div>
                    <form
                      className="chatComposer"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void send();
                      }}
                    >
                      <input
                        placeholder="Digite uma mensagem..."
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                      <button
                        disabled={!draft.trim() || busy === "send"}
                        title="Enviar mensagem"
                      >
                        <Send size={18} />
                      </button>
                    </form>
                  </div>
                  <div className="docsBox">
                    <div className="docsHeading">
                      <div>
                        <CheckCircle2 size={20} />
                        <strong>
                          Documentos recebidos (
                          {
                            docsFor(active.id).filter(
                              (d) => d.status !== "rejected",
                            ).length
                          }
                          )
                        </strong>
                      </div>
                      <button
                        disabled={busy === "zip"}
                        onClick={() => void downloadAll()}
                      >
                        <Download size={15} /> Baixar ZIP
                      </button>
                    </div>
                    <div className="docGrid">
                      {docsFor(active.id).map((d) => (
                        <div key={d.id} className="docTile">
                          <button
                            type="button"
                            className="docDownload"
                            onClick={() => void downloadDoc(d)}
                            disabled={!d.storage_path}
                            title={
                              d.storage_path
                                ? "Baixar arquivo"
                                : "Arquivo não armazenado"
                            }
                          >
                            <FileText size={25} />
                            <span>{docLabels[d.kind] || d.kind}</span>
                          </button>
                          <button
                            className="previewDoc"
                            type="button"
                            onClick={() => void viewDoc(d)}
                            disabled={!d.storage_path}
                          >
                            Visualizar
                          </button>
                          <small>
                            {d.status === "verified"
                              ? "✓ Validado"
                              : d.status === "rejected"
                                ? "Rejeitado"
                                : "Aguardando conferência"}
                          </small>
                          {
                            <div className="docVerify">
                              <select
                                aria-label="Tipo do documento"
                                defaultValue={d.kind}
                                id={"kind-" + d.id}
                              >
                                {Object.keys(docLabels).map((kind) => (
                                  <option key={kind} value={kind}>
                                    {docLabels[kind]}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={busy === d.id}
                                title="Validar documento"
                                onClick={() => {
                                  const el = document.getElementById(
                                    "kind-" + d.id,
                                  ) as HTMLSelectElement | null;
                                  void validateDocument(
                                    d,
                                    el?.value || d.kind,
                                    "verified",
                                  );
                                }}
                              >
                                <Check size={13} />
                              </button>
                              <button
                                type="button"
                                disabled={busy === d.id}
                                title="Rejeitar documento"
                                onClick={() =>
                                  void validateDocument(d, d.kind, "rejected")
                                }
                              >
                                ✕
                              </button>
                            </div>
                          }
                        </div>
                      ))}
                      {!docsFor(active.id).length && (
                        <p className="muted">Nenhum documento registrado.</p>
                      )}
                    </div>
                    {["conversando", "leads", "leads_campaign"].includes(
                      active.stage,
                    ) && (
                      <button
                        className="smallAction"
                        disabled={busy === active.id}
                        onClick={() => void perform("missing", active)}
                      >
                        Solicitar itens faltantes
                      </button>
                    )}
                    {active.stage === "conversando" && (
                      <div className="productionGate">
                        <span>
                          {canGoProduction(active)
                            ? "Todos os documentos foram conferidos."
                            : "Revise os arquivos para liberar a produção."}
                        </span>
                        <button
                          type="button"
                          disabled={!canGoProduction(active)}
                          onClick={() => void moveToProduction(active)}
                        >
                          Enviar para Produção
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="infoBox">
                    <h3>Informações do cliente</h3>
                    <button
                      className="smallAction"
                      disabled={busy === active.id}
                      onClick={() =>
                        void classifyContact(active.contact_id, "personal")
                      }
                    >
                      Classificar como pessoal
                    </button>
                    <Info
                      label="Nome"
                      value={active.display_name || "Não informado"}
                    />
                    <Info
                      label="Telefone"
                      value={active.phone || "Não informado"}
                    />
                    <label className="fieldLabel">
                      E-mail
                      <input
                        key={active.id + "email"}
                        type="email"
                        defaultValue={active.email || ""}
                        onBlur={(e) => {
                          if (
                            e.target.value !== active.email &&
                            e.target.validity.valid
                          )
                            void perform("details", active, {
                              email: e.target.value,
                            });
                        }}
                      />
                    </label>
                    <label className="fieldLabel">
                      Serviço
                      <select
                        value={active.service}
                        disabled={
                          !["leads", "leads_campaign", "conversando"].includes(
                            active.stage,
                          )
                        }
                        onChange={(e) =>
                          void perform("details", active, {
                            service: e.target.value,
                          })
                        }
                      >
                        <option value="desconhecido" disabled>
                          A identificar
                        </option>
                        <option value="uber">Uber</option>
                        <option value="documento">Documento do carro</option>
                      </select>
                    </label>
                    <button
                      className="smallAction"
                      disabled={busy === active.id}
                      onClick={() =>
                        void perform("pause", active, {
                          paused: !active.automation_paused,
                        })
                      }
                    >
                      {active.automation_paused
                        ? "Retomar automação"
                        : "Pausar automação"}
                    </button>
                    <hr />
                    <Info
                      label="Serviço"
                      value={
                        active.service === "uber"
                          ? "Cadastro na Uber"
                          : active.service === "documento"
                            ? "Documento do carro"
                            : "A identificar"
                      }
                    />
                    <Info
                      label="Problema"
                      value={active.issue || "Não informado"}
                    />
                    <Info label="Valor" value={currency(active.price_cents)} />
                    <Info label="Origem" value={active.source} />
                    <Info
                      label="Situação"
                      value={
                        active.payment_status === "confirmed"
                          ? "Pago"
                          : active.payment_status === "proof_received"
                            ? "Comprovante recebido"
                            : "Pendente"
                      }
                    />
                    {active.stage === "finalizados" && (
                      <button
                        className="primaryBtn"
                        onClick={() =>
                          void (active.delivered_at
                            ? confirmPayment(active)
                            : confirmDelivery(active))
                        }
                      >
                        {active.delivered_at
                          ? "Confirmar pagamento"
                          : "Registrar entrega por videochamada"}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="emptyWork">
                  <ShieldCheck size={32} />
                  <h3>Pronto para começar</h3>
                  <p>
                    Selecione um card em Produção e clique em Começar para abrir
                    o atendimento aqui embaixo.
                  </p>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="metric">
      <div className="metricIcon">{icon}</div>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="infoRow">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}
