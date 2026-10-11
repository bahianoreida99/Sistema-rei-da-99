# Publicação e recuperação

Use somente GitHub `bahianoreida99/Sistema-rei-da-99`, Supabase `mvjokrceegoycsunlgme` e Railway `fe31c819-9d73-454e-ae1b-26bd6ef8bc63` / `production`.

## GitHub

Autorize `gh auth login` como `bahianoreida99`. O script `publicar-github.ps1` valida a conta, remoto e branch, recusa arquivos sensíveis e usa somente a autenticação do GitHub CLI. Recomendamos tornar o repositório privado; ele estava público na inspeção inicial.

## Supabase

Antes de migrar, inspecione `information_schema.columns`, `pg_policies`, grants e `supabase_migrations.schema_migrations`. Faça backup. `CREATE TABLE IF NOT EXISTS` na migração inicial não corrige diferenças de colunas ou políticas em um banco existente.

Migrações adicionais são aditivas: `20261011000200_security_and_retention.sql` verifica administrador confirmado e transições financeiras; `20261011000300_webhook_recovery.sql` acrescenta fila privada, lease, retries e colunas de deduplicação. Aplique somente depois de comparar com o esquema real. Não marque migrations como aplicadas sem conferir os objetos do banco.

O bucket `bahiano-documentos` deve ser privado. URLs assinadas duram 60 segundos. Somente `bahiano.reida99uber@gmail.com`, com e-mail confirmado, pode administrar. Nunca coloque a chave service_role no frontend.

## Railway

### API

`Dockerfile` compila a API compartilhada. Start: `node backend/server.mjs`; porta 3001; domínio deve apontar para 3001.

Configure no serviço `bahiano-api`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `WAHA_BASE_URL`, `WAHA_API_KEY`, `BAHIANO_WEBHOOK_TOKEN`, `PORT=3001`. `WEBHOOK_TOKEN` é aceito como alias da configuração anterior. Valores privados ficam somente nos secrets.

`/health` retorna `configured`. HTTP 200 sozinho não comprova integração operacional. Aplique as novas migrations antes de conectar o webhook à API atual.

### WAHA

Preserve o volume `/app/.sessions`, a API Key e a proteção de Dashboard/Swagger. Porta interna 8080. Configure um único webhook depois da homologação:

```dotenv
WHATSAPP_HOOK_URL=https://bahiano-api-production.up.railway.app/webhook/waha
WHATSAPP_HOOK_EVENTS=message,message.any,session.status
WHATSAPP_HOOK_CUSTOM_HEADERS=X-Bahiano-Webhook-Token:<segredo-do-backend>
WHATSAPP_HOOK_RETRIES_POLICY=linear
WHATSAPP_HOOK_RETRIES_DELAY_SECONDS=2
WHATSAPP_HOOK_RETRIES_ATTEMPTS=3
```

Configure o segredo diretamente na Railway. Confira também os webhooks da sessão, que podem prevalecer sobre as variáveis globais. Mantenha `business_settings.bot.enabled=false` até confirmar o telefone do Bahiano e homologar o fluxo sem clientes reais.

No Dashboard do painel, consulte a conexão e atualize o QR por rotas autenticadas. No celular do Bahiano: WhatsApp → Aparelhos conectados → Conectar aparelho. Reiniciar a sessão não apaga o volume. Na inspeção foi observado WEBJS 2026.9.2 e `Cmd.refreshQR is not a function`; restart recuperou SCAN_QR_CODE. Mudanças de engine exigem validar os eventos e mídias.

Referências: [sessões e QR](https://waha.devlike.pro/docs/how-to/sessions/), [eventos](https://waha.devlike.pro/docs/how-to/events/), [engines](https://waha.devlike.pro/docs/how-to/engines/).

### Frontend

`Dockerfile.frontend` usa Next.js standalone e somente as configurações públicas de `.env.example`. Em um pacote separado do frontend, use esse arquivo com o nome `Dockerfile`; serviço `bahiano-painel`, porta 3000. API e frontend usam builds diferentes.

### Vercel

Importe o repositório, branch `main`, framework Next.js. `vercel.json` usa `npm ci` e `npm run build`. Configure as três variáveis de `.env.example`. Nenhuma chave privada deve existir no frontend. O backend Railway funciona independentemente da Vercel.

## Recuperação e retenção

A fila privada usa lease para impedir processamento concorrente do mesmo evento. Duplicatas concluídas são ignoradas; falhas e leases expirados são recuperados a cada 30 segundos pelo servidor Railway. Arquivos têm caminho determinístico, e saudações/produção/finalização têm chaves de ação. Envios com resposta de rede perdida podem ter resultado ambíguo; confira o histórico antes de repetir manualmente. Não existe transação atômica entre WhatsApp e PostgreSQL.

Se usar somente Supabase Edge, agende a chamada autenticada de `/internal/retry`; a função Edge não mantém o timer Railway.

A retenção proposta de 90 dias exige revisão do proprietário e mantém exclusão automática desativada. Nenhum documento existente é apagado pelo deploy. Defina prazo, finalidade e descarte antes do uso real; inclua contatos, mensagens e payloads da fila na política.

Faça backup do PostgreSQL, Storage privado e volume WAHA antes de alterações. Proteja o volume como credencial de WhatsApp; nunca publique backups no Git. Para rollback de código, use deployment/commit conhecido. Não reverta migrations apagando tabelas com dados. Durante incidentes, pause a automação e preserve os registros.
