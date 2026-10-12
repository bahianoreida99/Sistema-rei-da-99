# Documentos, automação e retenção — 11/10/2026

Publicado no painel: https://bahiano-painel-production.up.railway.app

## Alterações

- Removido o seletor manual de tipo dos documentos. O painel usa a classificação do bot; validar/rejeitar continuam sendo conferência humana.
- Visualizar abre um diálogo dentro do painel. Arquivo privado baixado com a sessão autenticada, URL local temporária liberada ao fechar, fechamento por Escape e botão.
- ZIP baixa diretamente todos os arquivos armazenados do atendimento, incluindo rejeitados. Uma falha impede gerar um ZIP parcial.
- Adicionados 21 arquivos fictícios, marcados sem validade, exclusivamente aos exemplos existentes. A imagem de selfie é ilustrativa e não representa identificação facial.
- Conversas sem atividade há 72 horas: limpeza agendada no banco a cada hora, minuto 7. Considera últimas mensagens recebidas/enviadas, atualização do atendimento/contato e atividades registradas. Apaga somente mensagens; documentos, clientes, etapas e pagamentos permanecem. O conteúdo correspondente de webhooks concluídos é esvaziado, preservando o identificador de deduplicação. Eventos ainda pendentes não são apagados.
- Demonstração excluída da limpeza até revisão e confirmação expressa do proprietário.
- Recebimentos, serviços pagos, parte do Bahiano e comissão usam pagamentos do mês atual, no fuso America/Sao_Paulo. Viram no dia 1º sem apagar registros. Pendências continuam incluindo todos os meses. Painel aberto verifica a virada a cada dez segundos.

## Evidências

- `npm test`, lint e build aprovados. Testes dos dois serviços da primeira mensagem à confirmação manual do pagamento, incluindo duplicidade, documentos ausentes, pause, comprovante pendente e controles de acesso.
- Execução real em produção dos dois serviços com arquivos fictícios enviados pelo WhatsApp ao número autorizado, webhooks de entrada simulados e respostas dos atendimentos de teste restritas ao CRM. Não representa dois clientes humanos percorrendo o fluxo manualmente nem pagamento bancário real.
- OCR de CNH/RG frente e verso e CRLV sem legenda: 88–94% de confiança nas amostras. Comprovante por imagem: 93%; PDF por texto: 100%. Selfie usa identificação informada pelo cliente; não há validação facial.
- Arquivos não reconhecidos solicitam ao cliente identificação do tipo/lado; o bot não deve adivinhar. Identificação não comprova autenticidade. Comprovante não confirma recebimento bancário; confirmação financeira continua humana.
- O primeiro reaproveitamento de links antigos de mídia falhou por expiração. Repetição com nove arquivos novos passou para os dois serviços, incluindo download privado, ZIP, produção, finalização, entrega e pagamento.
- Playwright no painel publicado: pop-up exibe imagem, Escape e fechar funcionam, seletor ausente, ZIP contém os três arquivos completos de Camila, layout móvel aprovado.
- Teste SQL transacional com rollback: mensagens inativas removidas, mensagem recente enviada protege conversa, documento preservado com vínculo de mensagem nulo, pagamento confirmado preservado, payload concluído limpo e execução negada ao navegador.
- Virada mensal testada nas fronteiras de 02:59:59 e 03:00:00 UTC (meia-noite em São Paulo); histórico financeiro permanece íntegro.

## Limites e revisão

O banco é Supabase, não Firebase. Limpeza reduz o crescimento das mensagens, mas não garante gratuidade permanente: documentos permanecem e há limites de banco, armazenamento e tráfego, além da hospedagem Railway. Referências: https://supabase.com/docs/guides/platform/billing-on-supabase e https://supabase.com/docs/guides/storage/pricing.

Para revisar: Ver exemplos → Kanban → Camila Souza ou Diego Almeida → Visualizar e Baixar ZIP. A demonstração só será removida depois da validação do proprietário.
