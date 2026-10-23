# Recuperação do Baiano da 99 no Render — 23/10/2026

## Estado verificado
- Render: workspace `Bahiano da 99`, sem serviços existentes no início da preparação.
- GitHub: repositório `bahianoreida99/Sistema-rei-da-99`, branch isolada `recovery/render-20261023`.
- Supabase: projeto `mvjokrceegoycsunlgme` ativo, com dados preservados.
- `business_settings.bot.enabled` foi definido como `false` antes de qualquer implantação.
- Nenhum serviço Render foi efetivamente criado pelo assistente: a operação de criação pelo plugin retornou bloqueio de segurança. O arquivo `render.yaml` é uma proposta de implantação que exige validação e confirmação no dashboard.

## Desenho de recuperação
- `bahiano-api-render`: serviço web Node.js em Virginia, build `npm ci && npm run build:api`, start `node backend/server.mjs`, health `/health`.
- `bahiano-painel-render`: serviço web Next.js em Virginia, build `npm ci && npm run build`, start na porta 10000.
- `bahiano-waha-render`: serviço **privado** em Virginia, imagem WAHA Core, disco persistente novo em `/app/.sessions`, engine NOWEB, Dashboard e Swagger desabilitados.
- Banco e Storage continuam no Supabase. Não migrar ou copiar documentos para o Render.
- O pipeline está vinculado à branch de recuperação com deploy automático desligado. Requer revisão antes de produção.

## Checklist de implantação no Render
1. Confira o GitHub e o Supabase, troque senhas/tokens expostos e remova acessos suspeitos. Não reutilize nenhum token da Railway.
2. Abra `https://dashboard.render.com/blueprints` > **New Blueprint**, conecte o repositório e selecione a branch `recovery/render-20261023` com arquivo `render.yaml`. Examine o plano e o preço antes de confirmar. **O Render poderá cobrar pelos três serviços e pelo disco.**
3. No primeiro sync, preencha `SUPABASE_SERVICE_ROLE_KEY` com uma **nova** chave secreta válida do projeto Supabase, nunca com valor antigo do ambiente comprometido. Todos os tokens privados ficam somente no Render.
4. Confirme se a imagem do WAHA é oficial e fixe um *digest* conhecido e verificado antes de ativar o WhatsApp. A referência `:latest` é temporária. Se o workspace exigir credencial Docker, configure no Render Dashboard.
5. Confira o Build/Deploy dos dois serviços Node. Verifique a API `/health`, logs e domínio HTTPS do painel. Uma resposta HTTP 200 em `/health` não prova que o WhatsApp está funcionando.
6. Confira a conexão privada WAHA/API. O Render injeta `WAHA_HOSTPORT` e `WAHA_API_KEY` automaticamente conforme o Blueprint. Se a comunicação falhar, confira a porta 3000 e o host privado real.
7. Configure no serviço WAHA as variáveis **somente após a API estar operacional**:
   - `WHATSAPP_HOOK_URL=http://<HOSTPORT_INTERNO_DA_API>/webhook/waha`
   - `WHATSAPP_HOOK_CUSTOM_HEADERS=X-Bahiano-Webhook-Token:<NOVO_TOKEN_DA_API>`
   - Mantenha `WHATSAPP_HOOK_EVENTS=message,message.any,session.status`.
   - O token é gerado em `BAHIANO_WEBHOOK_TOKEN` do serviço API; não publique o valor no GitHub ou em prints.
8. No Supabase Auth, configure o novo domínio HTTPS do painel em Site URL/Redirect URLs, preservando somente os redirecionamentos necessários. Confira a sessão administrativa existente.
9. Gere uma sessão WAHA **nova** e conecte o WhatsApp por QR Code a partir da interface do painel (sem importar arquivos de sessão do ambiente comprometido).
10. Configure `business_settings.bot.value.test_chat_ids` com **apenas** números autorizados para homologação, mantendo `enabled=false` até verificar webhook, áudio, texto, imagens, QR e documentos.
11. Em ambiente controlado, habilite o bot apenas para essa lista. Verifique reenvio, idempotência e regra de cinco minutos; confirme funcionamento ponta a ponta. Só libere os demais contatos com aprovação explícita do responsável.
12. Revise `meta_config` caso use integração Meta. Uma nova `META_CONFIG_ENCRYPTION_KEY` **não consegue decifrar** tokens antigos; refaça a conexão e a criptografia com novos segredos se necessário.

## Custos e segurança
O Blueprint propõe inicialmente dois serviços de 2 GB, um serviço de 512 MB e disco de 2 GB. Verifique o valor em USD no próprio Render antes de sincronizar. A especificação não provisiona banco Render nem copia dados pessoais.

**Não faça:** reaproveitar sessões WAHA ou tokens da Railway, expor WAHA à internet, ligar o robô antes da homologação, colocar `service_role` no frontend, publicar capturas de documentos de clientes ou garantir que uma aprovação externa esteja concluída sem verificação.

## Limitações deste pacote
- O `render.yaml` é uma preparação; nenhum serviço foi criado automaticamente no Render.
- A identidade da conta Supabase foi verificada pela conexão existente, mas a investigação forense da possível invasão na Railway não foi possível sem acesso ao ambiente.
- Antes da ativação, confirme se o responsável controla o WhatsApp, GitHub e Supabase, e se os procedimentos e documentos atendem aos requisitos legais das plataformas envolvidas.
