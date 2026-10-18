import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const ADMIN_USER_ID = process.env.NEXT_PUBLIC_ADMIN_USER_ID || "";
export const configured = Boolean(url && key && ADMIN_USER_ID);
export const supabase = configured
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(15000)]) }) },
    })
  : null;
export const ADMIN_EMAIL = "bahiano.reida99uber@gmail.com";
export const isAdmin = (user: { id?: string; email?: string; email_confirmed_at?: string | null } | null | undefined) =>
  Boolean(user?.email_confirmed_at && ADMIN_USER_ID && user.id === ADMIN_USER_ID);
export type Stage =
  | "leads"
  | "leads_campaign"
  | "conversando"
  | "producao"
  | "finalizados"
  | "pagos";
export interface Lead {
  id: string;
  contact_id: string;
  display_name: string | null;
  phone: string | null;
  email: string | null;
  service: "uber" | "documento" | "desconhecido";
  issue: string | null;
  price_cents: number;
  source: string;
  campaign_code: string | null;
  stage: Stage;
  payment_status: "unpaid" | "proof_received" | "confirmed";
  automation_paused: boolean;
  production_started_at: string | null;
  finished_at: string | null;
  delivered_at: string | null;
  paid_at: string | null;
  created_at: string;
  documents_complete_at: string | null;
  conversation_context?: { kanban_archived_at?: string; [key: string]: unknown } | null;
}
export interface Msg {
  id: string;
  lead_id: string | null;
  direction: "incoming" | "outgoing";
  body: string | null;
  kind: string;
  received_at: string;
}
export interface Doc {
  id: string;
  lead_id: string;
  kind: string;
  status: string;
  storage_path: string | null;
  received_at: string;
  identification_note?: string | null;
  identification_method?: string | null;
}
export const stages: { id: Stage; title: string; subtitle: string }[] = [
  { id: "leads", title: "Leads", subtitle: "Outras fontes" },
  {
    id: "leads_campaign",
    title: "Leads campanha",
    subtitle: "Site e anúncios",
  },
  {
    id: "conversando",
    title: "Conversando",
    subtitle: "Respondeu à automação",
  },
  { id: "producao", title: "Produção", subtitle: "Documentação completa" },
  { id: "finalizados", title: "Finalizados", subtitle: "Aguardando entrega" },
  { id: "pagos", title: "Pagos", subtitle: "Pagamento confirmado" },
];
export const currency = (centavos: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    centavos / 100,
  );
