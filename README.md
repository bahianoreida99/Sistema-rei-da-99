# Sistema Bahiano Rei da 99

Painel Next.js com Dashboard inicial, Kanban de seis etapas e área integrada de produção, conversa e documentos. API TypeScript compartilhada entre Railway/Node e Supabase Edge; configure somente um destino de webhook.

## Recursos exclusivos

- GitHub: bahianoreida99/Sistema-rei-da-99, branch main.
- Supabase: mvjokrceegoycsunlgme.
- Railway: fe31c819-9d73-454e-ae1b-26bd6ef8bc63, production.
- Serviços: bahiano-api, waha-whatsapp, bahiano-painel.
- Administrador: bahiano.reida99uber@gmail.com, com e-mail confirmado no Supabase Auth.

Nenhuma senha administrativa é distribuída no código. Secrets ficam nas plataformas; .env.example contém somente configurações públicas.

## Executar e validar

Use Node.js 22 ou superior. Copie .env.example para .env.local.

```sh
npm ci
npm run dev
npm run lint
npm run typecheck
npm run typecheck:api
npm test
npm run build
npm run build:api
npm run start:api
```

A API local usa porta 3001 e exige suas próprias variáveis privadas no processo. Não compartilhe o ambiente backend com o frontend. O servidor atual é backend/server.mjs, executando a função compartilhada compilada por scripts/build-api.mjs. backend/railway-function.ts é referência do protótipo anterior.

## Atendimento e financeiro

Mensagens desconhecidas não criam leads automaticamente. Classificações pessoais e manuais são respeitadas. A primeira saudação mantém a origem; somente uma resposta posterior move para Conversando. Site orgânico sem atribuição rastreada não gera comissão de campanha.

Imagens sem identificação ficam em Outro. A conferência humana define tipo, legibilidade e aprovação. Solicitar faltantes exige 30 segundos após o último envio e não repete arquivos já recebidos. A produção exige documentos verificados, telefone e e-mail. Com robô habilitado, validar o último documento libera a produção; desabilitado, o administrador libera explicitamente.

Uber usa CNH frente/verso, RG frente/verso, CRLV e selfie. Documento do carro usa RG frente/verso e CRLV. Valide essas listas comerciais antes de ativar. Não há modelo visual ou API de IA paga.

Começar carrega a área de produção. Documentos permitem visualização temporária, download individual e ZIP. Finalizado envia convite para videochamada. Registrar entrega é obrigatório antes de Confirmar pagamento. Comprovantes e declarações de pagamento ficam pendentes de confirmação real.

Financeiro considera recebimentos confirmados após entrega. Uber: venda R$ 350, parte Bahiano R$ 270 e comissão rastreada R$ 80. A divisão do documento de R$ 150 é configurável no Dashboard; nenhum repasse é presumido antes disso.

## Qualidade e limites da validação

Os testes executam a API real com banco/transporte simulados, sem envio externo. Cobrem autorização, origem, pessoais/desconhecidos, primeira resposta, duplicatas, anexos privados, origem externa recusada, documentação ausente, produção, finalização, comprovante, entrega/pagamento, pausa, bot desativado, falhas WAHA, recuperação de evento e eventos do telefone/sessão. Testes financeiros cobrem receita, comissão, atribuição e divisão configurável.

Esses testes não comprovam RLS e triggers do banco real, o número conectado nem envios reais. Homologação integrada exige acesso administrativo: inspecione schema/migrations, confira anon/outros usuários, valide pagamentos em transação de teste seguida de rollback, teste assinatura/ZIP com arquivos autorizados e confirme WORKING no telefone correto. Não envie mensagens a clientes durante os testes.

## Publicar e recuperar

Consulte [publicação, segurança e recuperação](docs/DEPLOYMENT.md). Não aplique a migração inicial indiscriminadamente em um banco existente. Preserve os dados e confira as políticas reais antes de alterar objetos.
