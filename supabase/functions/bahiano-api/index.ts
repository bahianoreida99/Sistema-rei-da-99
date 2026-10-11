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
const adminEmail = "bahiano.reida99uber@gmail.com";
const required = [
  "cnh_frente",
  "cnh_verso",
  "rg_frente",
  "rg_verso",
  "crlv",
  "selfie",
];
const requiredFor = (lead: any): string[] =>
  lead.service === "documento" ? ["rg_frente", "rg_verso", "crlv"] : required;
const docs: Record<string, string> = {
  cnh_frente: "CNH frente",
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
  const r = await fetch(up(t, q), { headers: apiHeaders() });
  if (!r.ok) throw Error(`Falha na leitura de ${t}: ${r.status}`);
  return await r.json();
}
async function insert(t: string, value: Record<string, unknown>): Promise<any> {
  const r = await fetch(up(t), {
    method: "POST",
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
  return String(u.email || "").toLowerCase() === adminEmail &&
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
const classify = (s: string) =>
  /(documento do carro|crlv|licenciamento|ve[ií]culo|carro fora do ano)/i.test(
    s,
  )
    ? "documento"
    : /(uber|cnh|habilita|ear|cadastro|motorista)/i.test(s)
      ? "uber"
      : "desconhecido";
const isLead = (s: string) =>
  /(uber|cnh|habilita|ear|cadastro|motorista|documento do carro|crlv|carro fora do ano|rodar|regulariz|or[cç]amento|pre[cç]o|\bREF\s*[:#-])/i.test(
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
function docType(s: string) {
  const x = s.toLowerCase();
  if (/comprovante|pix|pagamento/.test(x)) return "comprovante";
  if (/cnh/.test(x) && /verso|atr[aá]s/.test(x)) return "cnh_verso";
  if (/cnh/.test(x) && /frente/.test(x)) return "cnh_frente";
  if (/rg/.test(x) && /verso|atr[aá]s/.test(x)) return "rg_verso";
  if (/rg/.test(x) && /frente/.test(x)) return "rg_frente";
  if (/crlv|documento do carro/.test(x)) return "crlv";
  if (/selfie/.test(x)) return "selfie";
  return "outro";
}
function identifyDocument(text: string, hint: string, confidence: number, method: string) {
  const clean = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const supplied = docType(hint);
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
      if (ambiguous) note = "Frente e verso encontrados no mesmo arquivo. Confira e separe os lados.";
      else if (side) kind = family + "_" + side;
      else if (supplied.startsWith(family + "_")) kind = supplied;
      else note = `${family.toUpperCase()} identificada. Confira e informe se é frente ou verso.`;
    }
    if (pending && receipt) note = "Possível agendamento ou transferência pendente; não comprova pagamento realizado.";
    else if (families > 1) { ambiguous = true; note = "Mais de um tipo de documento encontrado; confira e separe os arquivos."; }
    if (kind !== "outro") note = kind === "comprovante"
      ? "Comprovante identificado pela leitura do arquivo. Confira valor, destinatário e recebimento; não confirma pagamento."
      : "Tipo sugerido pela leitura do arquivo. A legibilidade e a validade exigem conferência.";
  }
  if (kind === "outro" && supplied !== "outro" && !ambiguous && !/agendad|pendente|nao realizad|cancelad|falhou|saldo insuficiente|qr code|cobranca/.test(clean)) {
    kind = supplied;
    method = "caption";
    note = "Tipo informado na mensagem ou nome do arquivo; conteúdo ainda exige conferência.";
  }
  return { kind, identification_method: method, identification_confidence: method === "caption" ? 0 : Math.max(0, Math.min(100, Math.round(confidence || 0))), identification_note: note };
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
    ? await reader(data, mime)
    : { text: "", confidence: 0, method: "unavailable" };
  const detected = identifyDocument(String(read.text || ""), String(p.body || "") + " " + String(p.media?.filename || ""), Number(read.confidence || 0), String(read.method || "unavailable"));
  if (Number(read.pages) > 1) detected.identification_note += " A leitura automática considerou apenas a primeira página; confira todas as páginas.";
  // Preserve explicit selfie labels; OCR cannot establish identity or authenticity.
  if (kind === "selfie" && detected.kind === "outro") detected.kind = "selfie";
  const path = lead.id + "/" + msg.id + "." + ext;
  const x = await fetch(url + "/storage/v1/object/bahiano-documentos/" + path, {
    method: "POST",
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
  const chat = String(p.fromMe ? p.to : p.from || "");
  const mid = typeof p.id === "string" ? p.id : String(p.id?._serialized || "");
  if (!chat.endsWith("@c.us") || !mid) return { ignored: true };
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
  if (!contact)
    contact = await insert("contacts", {
      chat_id: chat,
      phone: chat.split("@")[0],
      display_name: String(p.notifyName || "").slice(0, 90) || null,
      classification: "unknown",
    });
  if (!contact)
    contact = (
      await rows("contacts", `?chat_id=eq.${encodeURIComponent(chat)}&select=*`)
    )[0];
  if (!contact) throw Error("Contato não disponível");
  const message = String(p.body || "").slice(0, 3500);
  let lead = (await rows("leads", `?contact_id=eq.${contact.id}&select=*`))[0];
  if (
    !lead &&
    contact.classification !== "personal" &&
    (!contact.manual_override || contact.classification === "lead") &&
    isLead(message)
  ) {
    const svc = classify(message),
      c = campaign(message),
      fromCampaign =
        !!c || /vim pelo site|vim pelo an[uú]ncio|meta ads/i.test(message);
    lead = await insert("leads", {
      contact_id: contact.id,
      display_name: contact.display_name,
      phone: contact.phone,
      service: svc,
      issue: issue(message),
      price_cents: svc === "uber" ? 35000 : svc === "documento" ? 15000 : 0,
      source: fromCampaign ? "site" : "whatsapp",
      campaign_code: c,
      stage: fromCampaign ? "leads_campaign" : "leads",
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
  if (!lead) return { classified: "unknown" };
  const now = new Date().toISOString();
  const proposed = docType(message);
  const email = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email)
    lead = await update("leads", lead.id, { email: email.slice(0, 254) });
  let uploaded: any = null;
  if (p.hasMedia) uploaded = await mediaUpload(p, lead, msg, proposed);
  const proof =
    lead.stage === "finalizados" &&
    (uploaded?.kind === "comprovante" || (!p.hasMedia && proposed === "comprovante"));
  if (
    proof ||
    (lead.stage === "finalizados" &&
      /paguei|pix feito|pagamento realizado/i.test(message))
  )
    await update("leads", lead.id, {
      payment_status: "proof_received",
      proof_received_at: now,
    });
  if (proof && !lead.automation_paused && await botOn(chat)) {
    await send(chat, "Recebemos o comprovante. ✅ O Baiano vai conferir o valor, o destinatário e o recebimento. O pagamento continua pendente até a confirmação.", lead, "proof-receipt:" + mid);
    return { lead_id: lead.id, stage: lead.stage, payment_status: "proof_received" };
  }
  if (!lead.welcome_sent_at) {
    if (
      !lead.automation_paused &&
      lead.service !== "desconhecido" &&
      ["leads", "leads_campaign"].includes(lead.stage) &&
      (await botOn(chat))
    ) {
      await send(chat, initial(lead), lead, "welcome:" + lead.id);
      await update("leads", lead.id, { welcome_sent_at: now });
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
  if (
    lead.automation_paused ||
    !(await botOn(chat)) ||
    ["producao", "finalizados", "pagos"].includes(lead.stage)
  )
    return { lead_id: lead.id, stage: lead.stage, paused: true };
  if (/falar com (atendente|pessoa|humano)|atendimento humano/i.test(message)) {
    await update("leads", lead.id, { automation_paused: true, automation_pause_reason: "manual" });
    await send(
      chat,
      "Certo! Vou encaminhar seu atendimento ao Baiano. Você pode continuar conversando por aqui.",
      lead,
    );
  } else if (p.hasMedia) {
    await send(
      chat,
      !uploaded
        ? "Não conseguimos registrar esse arquivo. Envie uma imagem JPG/PNG/WebP ou PDF de até 12 MB."
        : uploaded.kind === "comprovante"
          ? "Recebemos o comprovante. ✅ O Baiano vai conferir o valor, o destinatário e o recebimento. O pagamento continua pendente até a confirmação."
          : uploaded.kind === "outro"
            ? "Recebemos o arquivo, mas precisamos confirmar o tipo ou o lado. Informe se é CNH frente/verso, RG frente/verso, CRLV ou selfie. Se estiver desfocado, envie uma nova foto nítida."
            : "Recebemos o arquivo! ✅ Identificamos: " + (docs[uploaded.kind] || uploaded.kind) + ". Vamos conferir a legibilidade e os dados antes de validar.",
      lead,
      "receipt:" + mid,
    );
  } else if (!p.hasMedia && proposed !== "outro" && proposed !== "comprovante") {
    const unknown = await rows("documents", `?lead_id=eq.${lead.id}&kind=eq.outro&status=eq.received&order=received_at.desc&limit=2`);
    if (unknown.length === 1 && Date.now() - Date.parse(unknown[0].received_at) < 10 * 60 * 1000) {
      await update("documents", unknown[0].id, { kind: proposed, identification_method: "message_followup", identification_confidence: 0, identification_note: "Tipo informado em mensagem posterior. Ainda exige conferência." });
      await send(chat, "Obrigado! Identificamos o arquivo como " + (docs[proposed] || proposed) + ". O Baiano ainda vai conferir a legibilidade e os dados.", lead, "identify-reply:" + mid);
    } else {
      await send(chat, "Envie o arquivo junto da identificação do tipo e do lado, para associarmos corretamente ao seu documento.", lead, "identify-reply:" + mid);
    }
  } else if (firstReply || email || /documentos?|enviar|faltando/i.test(message)) {
    const existingDocs = await rows("documents", `?lead_id=eq.${lead.id}&select=kind,status`);
    const missing = requiredFor(lead).filter(kind => !existingDocs.some(d => d.kind === kind && d.status !== "rejected"));
    const list = missing.map(kind => "• " + docs[kind]);
    if (!lead.email) list.push("• E-mail");
    await send(chat, list.length ? "Perfeito! Para continuar o atendimento, envie:\n" + list.join("\n") + "\nEnvie uma foto nítida de cada lado. Se já enviou um arquivo sem identificação, informe o tipo e o lado." : "Recebemos os itens solicitados. O Baiano vai conferir os documentos antes de liberar a produção.", lead, "guidance:" + mid);
  } else if (/valor|pre[cç]o|quanto|custa/i.test(message)) {
    await send(chat, "O valor do serviço é " + (lead.service === "documento" ? "R$ 150,00" : "R$ 350,00") + ". O pagamento acontece após a entrega do serviço contratado. O Baiano vai analisar os documentos antes de confirmar a viabilidade.", lead, "price:" + mid);
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
    if (data.status === "verified" && data.kind === "outro")
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
        requiredFor(lead).every((kind) => verified.some((d) => d.kind === kind))
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
          !documentRows.some((d) => d.kind === kind && d.status !== "rejected"),
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
    if (!lead.email || !lead.phone)
      return response({ error: "Telefone e e-mail são obrigatórios" }, 409);
    const missing = requiredFor(lead).filter((x) => !verified.has(x));
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
    await send(
      contact.chat_id,
      "Olá! ✅ Seu serviço está finalizado. Por favor, ligue para o Baiano aqui pelo WhatsApp para combinar a entrega por videochamada. O pagamento acontece somente após a entrega, conforme combinado.",
      lead,
      "finish:" + lead.id,
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
    if (disconnect) {
      const loggedOut = await call("/api/sessions/default/logout", "POST");
      if (!loggedOut.ok) throw Error("Falha ao desconectar aparelho");
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
        hookKey
      ),
      bot_enabled: await botOn().catch(() => false),
    });
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
