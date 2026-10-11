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

## Homologação dos envios ao número autorizado

O proprietário informou um número de teste reconhecido pelo WhatsApp. A API publicada realizou quatro envios reais: identificação do teste, saudação, aviso de produção e convite de videochamada. Foram verificados os registros de saída, a saudação única após webhook repetido, a mudança para Conversando, a entrada automática em Produção após a última validação e o fluxo de finalização/entrega/pagamento.

As entradas foram simuladas por webhook autenticado e a documentação foi representada por registros temporários sem arquivos pessoais. Isso valida os envios reais e a lógica operacional, mas não substitui o percurso de recebimento de documentos pelo celular. Os dados temporários do CRM foram removidos. Durante a homologação, a automação respondeu somente ao número autorizado; o modo restrito também possui teste de regressão.

Após esses testes, a automação foi habilitada para operação. O proprietário confirmou que as quatro mensagens chegaram ao WhatsApp do número autorizado. Na homologação complementar, o backend publicado leu anexos fictícios que atravessaram o WhatsApp, reconheceu o comprovante pela imagem e pelo PDF, e validou downloads assinados e ZIP. O proprietário também confirmou a resposta automática de comprovante recebido e pagamento pendente. Consulte [as evidências completas e os limites](VALIDACAO-AUTOMACAO.md); as entradas das jornadas automatizadas foram simuladas por webhook autenticado.

Referências técnicas: [Supabase Realtime](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes), [configuração dos webhooks WAHA](https://waha.devlike.pro/docs/how-to/config/).
