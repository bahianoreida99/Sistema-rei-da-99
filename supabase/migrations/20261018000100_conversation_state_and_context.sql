-- Persist the sales-conversation state independently of WhatsApp webhook echoes.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS conversation_state text NOT NULL DEFAULT 'discover_service',
  ADD COLUMN IF NOT EXISTS conversation_context jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.leads
SET conversation_state = CASE
  WHEN stage IN ('producao','finalizados','pagos') THEN 'post_sale'
  WHEN service = 'desconhecido' THEN 'discover_service'
  WHEN welcome_sent_at IS NOT NULL THEN 'collecting_documents'
  ELSE 'qualify_service'
END
WHERE conversation_state = 'discover_service';

COMMENT ON COLUMN public.leads.conversation_state IS
  'Estado determinístico do funil conversacional; evita reiniciar perguntas e mantém a próxima ação contextual.';
COMMENT ON COLUMN public.leads.conversation_context IS
  'Contexto estruturado do funil conversacional, como tipo de conta, problema informado e objeções comerciais.';
