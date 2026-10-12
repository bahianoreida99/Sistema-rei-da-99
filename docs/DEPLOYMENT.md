# Publicação e recuperação

Use somente GitHub `bahianoreida99/Sistema-rei-da-99`, Supabase `mvjokrceegoycsunlgme` e Railway `fe31c819-9d73-454e-ae1b-26bd6ef8bc63` / `production`.

## GitHub

Autorize `gh auth login` como `bahianoreida99`. O script `publicar-github.ps1` valida a conta, remoto e branch, recusa arquivos sensíveis e usa somente a autenticação do GitHub CLI. Recomendamos tornar o repositório privado; ele estava público na inspeção inicial.

## Supabase

Antes de migrar, inspecione `information_schema.columns`, `pg_policies`, grants e `supabase_migrations.schema_migrations`. Faça backup. `CREATE TABLE IF NOT EXISTS` na migração inicial não corrige diferenças de colunas ou políticas em um banco existente.

Migrações adicionais são aditivas: `20261011000200_security_and_retention.sql` verifica administrador confirmado e transições financeiras; `20261011000300_webhook_recovery.sql` acrescenta fila privada, lease, retries e colunas de deduplicação; `20261011000400_realtime_and_service_pricing.sql` publica as sete tabelas do CRM e configura os repasses acordados. As três foram aplicadas e verificadas no banco em 11/10/2026. O banco também possui duas migrações anteriores em seu histórico; não substitua esse histórico pela migração inicial local.

O bucket `bahiano-documentos` deve ser privado. URLs assinadas duram 60 segundos. Somente `bahiano.reida99uber@gmail.com`, com e-mail confirmado, pode administrar. Nunca coloque a chave service_role no frontend.

`20261011000500_document_identification.sql` acrescenta método, confiança e observação de identificação aos documentos. `20261011000600_automation_pause_reason.sql` distingue pausa manual da pausa por produção. Ambas foram aplicadas e verificadas em 11/10/2026.

## Railway

### API

`Dockerfile` compila a API compartilhada. Start: `node backend/server.mjs`; porta 3001; domínio deve apontar para 3001.

O backend inclui o leitor local de imagens/PDFs, o modelo de português e dependências nativas de canvas distribuídas pelo npm. Uma leitura usa worker isolado, limite de 25 segundos e fila limitada. Falhas de leitura mantêm conferência pendente; o texto extraído não é persistido integralmente. O Supabase Edge não executa esse worker Node.

Configure no serviço `bahiano-api`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `WAHA_BASE_URL`, `WAHA_API_KEY`, `BAHIANO_WEBHOOK_TOKEN`, `PORT=3001`. `WEBHOOK_TOKEN` é aceito como alias da configuração anterior. Valores privados ficam somente nos secrets.

Configure também `BAHIANO_ADMIN_USER_ID` com o UUID da conta proprietária. O frontend exige o mesmo UUID em `NEXT_PUBLIC_ADMIN_USER_ID`; esse identificador é público, mas a permissão depende do JWT validado e da conta confirmada no banco, nunca do valor informado por um visitante.

Para Meta, `META_CONFIG_ENCRYPTION_KEY` contém 32 bytes aleatórios em base64. A chave permanece exclusiva do backend e deve ser preservada entre deployments/backups. Pixel, token cifrado, ativação e código de teste ficam em `meta_config`, sem acesso direto do navegador. `meta_events` permite apenas SELECT ao proprietário confirmado e participa de Realtime; alterações de situação são exclusivas do servidor. `META_GRAPH_VERSION` é opcional, com padrão `v26.0`.

As migrações `20261011000700_meta_events.sql`, `20261011000800_admin_identity.sql` e `20261011000900_meta_realtime.sql` foram aplicadas. A configuração Auth foi sincronizada seletivamente: Site URL do painel, redirecionamentos e mínimo de 8 caracteres, mantendo as outras propriedades remotas. Execute `supabase config diff` antes de aplicar futuras alterações.

`/health` retorna `configured`. HTTP 200 sozinho não comprova integração operacional. Aplique as novas migrations antes de conectar o webhook à API atual.

### WAHA

Preserve o volume `/app/.sessions`, a API Key e a proteção de Dashboard/Swagger. Porta interna 8080. Configure um único webhook depois da homologação:

```dotenv
WHATSAPP_HOOK_URL=http://bahiano-api.railway.internal:3001/webhook/waha
WHATSAPP_HOOK_EVENTS=message,message.any,session.status
WHATSAPP_HOOK_CUSTOM_HEADERS=X-Bahiano-Webhook-Token:<segredo-do-backend>
WHATSAPP_HOOK_RETRIES_POLICY=exponential
WHATSAPP_HOOK_RETRIES_DELAY_SECONDS=2
WHATSAPP_HOOK_RETRIES_ATTEMPTS=5
WAHA_BASE_URL=http://waha-whatsapp.railway.internal:8080
WAHA_PUBLIC_URL=https://waha-whatsapp-production-258f.up.railway.app
WHATSAPP_FILES_LIFETIME=3600
WHATSAPP_FILES_FOLDER=/app/.sessions/media
```

Configure o segredo diretamente na Railway. Confira também os webhooks da sessão, que podem prevalecer sobre as variáveis globais. Mantenha `business_settings.bot.enabled=false` até confirmar o telefone do Bahiano e homologar o fluxo sem clientes reais.

Links de mídia devem apontar para o WAHA configurado, nunca para localhost. O cache temporário de mídia foi ampliado de 3 minutos para 1 hora e colocado no volume privado existente para tolerar recuperação e reinício; o armazenamento permanente dos documentos continua no bucket privado do Supabase. Expiração desse cache não remove documentos já armazenados no Supabase.

Para homologar saídas sem responder a outros contatos, use `business_settings.bot.value.test_chat_ids` com uma lista explícita de IDs WhatsApp autorizados e `enabled=true`. Remova a restrição (ou use `null`) somente para operação normal. O teste real de 11/10/2026 usou essa restrição e, ao concluir a validação das ações, habilitou a operação normal; a confirmação de recebimento pelo destinatário consta no relatório de validação.

No Dashboard, o estado da conexão é consultado automaticamente. O único botão alterna entre Conectar e Desconectar; a indicação verde aparece apenas quando a sessão está WORKING. Conectar reaproveita o QR disponível ou a sessão em preparação; inicia uma sessão parada e reinicia uma sessão em falha uma única vez, sem logout automático; Desconectar efetua logout e para a sessão. O QR é exibido em uma janela de 60 segundos, com contagem regressiva e atualização automática para acompanhar a rotação do WhatsApp. Após expirar, clique em Conectar novamente. No celular do Bahiano: WhatsApp → Aparelhos conectados → Conectar aparelho. Reiniciar a sessão não apaga o volume. Na inspeção foi observado WEBJS 2026.9.2 e `Cmd.refreshQR is not a function`; restart recuperou SCAN_QR_CODE. O motor foi alterado para NOWEB 2026.9.2 com WAHA_NOWEB_WA_VERSION=auto-web após falhas reais WEBJS (Cmd.refreshQR e fechamento da página). O volume anterior permanece preservado em seu namespace. WAHA_PRINT_QR=false. A API acessa WAHA pela rede privada, com WAHA_PUBLIC_URL para validar e reescrever URLs de mídia. Timeout de operação no painel: 15s; preparação de QR: 20s; janela de leitura: 60s após a primeira imagem. As consultas acompanham a rotação sem substituir a imagem quando os bytes são os mesmos. Mudanças de engine exigem homologar eventos e mídias antes de ativar a automação.

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
