# Sistema Bahiano Rei da 99

Painel Next.js com Dashboard inicial, Kanban de seis etapas e área integrada de produção, conversa e documentos. API TypeScript compartilhada entre Railway/Node e Supabase Edge; configure somente um destino de webhook.

## Recursos exclusivos

- GitHub: bahianoreida99/Sistema-rei-da-99, branch main.
- Supabase: mvjokrceegoycsunlgme.
- Railway: fe31c819-9d73-454e-ae1b-26bd6ef8bc63, production.
- Serviços: bahiano-api, waha-whatsapp, bahiano-painel.
- Administrador: bahiano.reida99uber@gmail.com, com e-mail confirmado no Supabase Auth.

Nenhuma senha administrativa é distribuída no código. Secrets ficam nas plataformas; .env.example contém somente configurações públicas.

A autorização vincula a conta confirmada ao UUID permanente do proprietário. `NEXT_PUBLIC_ADMIN_USER_ID` é obrigatório no frontend e `BAHIANO_ADMIN_USER_ID` na API; um e-mail coincidente não concede acesso a outra identidade. O e-mail inicial pode ser alterado em **Configurações**, acima de Sair, sem alterar esse vínculo.

## Configurações e Meta Ads

Configurações reúne e-mail, nova senha/confirmar senha, Pixel/conjunto de dados, site, token da API de Conversões e código de Eventos de Teste. O token é criptografado com AES-256-GCM usando `META_CONFIG_ENCRYPTION_KEY` (32 bytes em base64, exclusivo do servidor) e nunca retorna ao navegador. Preserve essa chave ao publicar ou recuperar um backup.

O banco registra Lead, Contact, DocumentReceived, DocumentVerified, ProductionStarted, ServiceCompleted, ServiceDelivered e Purchase. A compra exige pagamento confirmado após entrega. IDs estáveis permitem recuperação sem criar outra identidade de evento. Exemplos e contatos pessoais são excluídos. O histórico tem paginação e realtime somente para o proprietário; a tabela de credenciais continua exclusiva do servidor. Telefone/e-mail de correspondência seguem em SHA-256; documentos e textos de conversa não são enviados à Meta.

O código de Pixel fornecido na tela registra PageView e WhatsAppClick no site público configurado; deve ser instalado nesse site após autorização de métricas. O painel não o carrega. A API usa a versão Graph configurável em `META_GRAPH_VERSION`, com padrão `v26.0`. O verde de conexão depende de acknowledgment real da Meta e é retirado após erro de entrega.

Consulte o [relatório completo da revisão](docs/REVISAO-COMPLETA-2026-10-11.md) para evidências, instruções e limites da validação.

## Executar e validar

Use Node.js 22 ou superior. Copie .env.example para .env.local.

```sh
npm ci
npm run dev
npm run lint
npm run typecheck
npm run typecheck:api
npm test
npm run test:documents
npm run build
npm run build:api
npm run start:api
```

A API local usa porta 3001 e exige suas próprias variáveis privadas no processo. Não compartilhe o ambiente backend com o frontend. O servidor atual é backend/server.mjs, executando a função compartilhada compilada por scripts/build-api.mjs. backend/railway-function.ts é referência do protótipo anterior.

## Atendimento e financeiro

Mensagens desconhecidas não criam leads automaticamente. Classificações pessoais e manuais são respeitadas. A primeira saudação mantém a origem; somente uma resposta posterior move para Conversando. Site orgânico sem atribuição rastreada não gera comissão de campanha.

Imagens sem identificação ficam em Outro. A conferência humana define tipo, legibilidade e aprovação. Solicitar faltantes exige 30 segundos após o último envio e não repete arquivos já recebidos. A produção exige documentos verificados, telefone e e-mail. Com robô habilitado, validar o último documento libera a produção; desabilitado, o administrador libera explicitamente.

Uber exige CNH frente/verso, CRLV e selfie. Documento do carro exige apenas CRLV. RG não é exigido nem solicitado em nenhum dos dois fluxos. RGs recebidos anteriormente permanecem disponíveis como documentos opcionais, preservados no histórico. O backend Railway faz leitura local de imagens e da primeira página de PDFs com Tesseract e PDF.js, sem API externa paga. Sugestões de tipo nunca validam identidade, autenticidade ou pagamento; a conferência humana permanece obrigatória. Selfie e lado sem informação suficiente exigem identificação na mensagem/conferência.

Após a primeira resposta, a automação orienta o envio dos itens faltantes. Quando existe apenas um arquivo não identificado recente, uma mensagem como “CNH frente” associa o tipo ao arquivo e mantém sua conferência pendente. A pausa por produção é liberada ao finalizar para acusar recebimento de comprovantes; pausas manuais são preservadas. Comprovantes identificados por leitura ficam em `proof_received`, sem contar como receita. Agendamentos e cobranças não são tratados como comprovante concluído.

Começar carrega a área de produção. Documentos permitem visualização temporária, download individual e ZIP. Finalizado envia convite para videochamada. Registrar entrega é obrigatório antes de Confirmar pagamento. Comprovantes e declarações de pagamento ficam pendentes de confirmação real.

Financeiro considera recebimentos confirmados após entrega. Uber: venda R$ 350, parte Bahiano R$ 270 e sua comissão R$ 80. Documento do carro: venda R$ 150, parte Bahiano R$ 100 e sua comissão R$ 50. O painel mostra sua comissão de todos os serviços pagos; a atribuição por campanha permanece separada no cálculo.

As sete tabelas do CRM participam da publicação Supabase Realtime, protegidas pelas políticas administrativas existentes. O painel mantém uma assinatura estável ao trocar de atendimento, atualiza a conversa aberta e busca novamente os dados ao reconectar ou voltar à janela. Há recuperação por consulta periódica quando a conexão cai.

O botão **Ver exemplos** mostra oito atendimentos fictícios nas seis etapas, conversas e documentos representativos sem arquivos pessoais. Dashboard e Kanban separam esses registros (`source=demonstracao`) dos dados reais. **Voltar aos dados reais** restaura a operação normal. Mensagens de atendimentos fictícios são simuladas dentro do CRM, sem chamadas ao WhatsApp.

## Qualidade e limites da validação

Os testes executam a API real com banco/transporte simulados, sem envio externo. Cobrem autorização, origem, pessoais/desconhecidos, primeira resposta, duplicatas, anexos privados, origem externa recusada, documentação ausente, produção, finalização, comprovante, entrega/pagamento, pausa, bot desativado, falhas WAHA, recuperação de evento e eventos do telefone/sessão. Testes financeiros cobrem receita, comissão, atribuição e divisão configurável.

Esses testes não comprovam RLS e triggers do banco real, o número conectado nem envios reais. Homologação integrada exige acesso administrativo: inspecione schema/migrations, confira anon/outros usuários, valide pagamentos em transação de teste seguida de rollback, teste assinatura/ZIP com arquivos autorizados e confirme WORKING no telefone correto. Não envie mensagens a clientes durante os testes.

## Publicar e recuperar

Consulte [publicação, segurança e recuperação](docs/DEPLOYMENT.md). Não aplique a migração inicial indiscriminadamente em um banco existente. Preserve os dados e confira as políticas reais antes de alterar objetos.
