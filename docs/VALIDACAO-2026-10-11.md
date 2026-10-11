# Validação do ambiente publicado — 11/10/2026

Painel: https://bahiano-painel-production.up.railway.app

## Confirmado

- API com banco configurado e WhatsApp em `WORKING`.
- Migrações adicionais de segurança, recuperação de webhook e realtime aplicadas no projeto `mvjokrceegoycsunlgme`.
- Eventos reais, autenticados como administrador, recebidos nas sete tabelas do CRM: contatos, leads, mensagens, documentos, atividade, campanhas e configurações. Teste completo em 1.953 ms.
- Lead de teste apareceu no painel publicado sem recarregar, em 1.918 ms. Conversa aberta recebeu mensagem do banco em tempo real. Botões reais de pausa e retomada responderam corretamente.
- API publicada validou edição de serviço/preço, pausa/retomada, documentação obrigatória, bloqueio de pagamento antes da entrega, entrega e confirmação de pagamento. Trigger real recusou pagamento incompleto.
- Webhook publicado recebeu evento de teste e manteve apenas uma mensagem após repetição. Webhooks reais do WAHA retornaram HTTP 200 pela rede privada.
- Dados temporários de contato, lead, mensagens, documentos, atividades e campanha foram removidos pelos IDs criados no teste. Não foram enviados WhatsApps a clientes.
- Lint, verificações TypeScript, testes da API e do financeiro, build de produção e layout móvel passaram.
- Uber: R$350 = R$270 Bahiano + R$80 comissão. Documento: R$150 = R$100 Bahiano + R$50 comissão. Comissões totais e atribuição por campanha são cálculos separados.

## Pendente de número autorizado

O proprietário escolheu informar outro número para homologar os envios externos. A automação global permanece desativada até esse teste. Saudações, solicitação de documentos, aviso de produção, convite de videochamada, anexos privados e downloads ZIP têm cobertura automatizada com transporte simulado; os envios reais e o percurso completo pelo celular ainda precisam dessa homologação.

Referências técnicas: [Supabase Realtime](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes), [configuração dos webhooks WAHA](https://waha.devlike.pro/docs/how-to/config/).
