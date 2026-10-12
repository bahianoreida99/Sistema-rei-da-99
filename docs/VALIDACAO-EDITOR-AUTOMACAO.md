# Editor da automação — 11/10/2026

Publicado em https://bahiano-painel-production.up.railway.app.

- Automação adicionada à navegação lateral, imediatamente abaixo de Kanban.
- 17 mensagens organizadas por gatilho: boas-vindas dos dois serviços, solicitação de documentos, itens recebidos, preço, atendimento humano, arquivo inválido, tipo desconhecido, documento identificado, identificação posterior, associação ao arquivo, comprovante recebido, pagamento em conferência, solicitação de comprovante, lembrete manual, produção e finalização.
- Busca, editor, prévia com dados fictícios, campos automáticos, indicação de alteração não salva, salvar individual e restaurar padrão.
- Mudanças persistidas em business_settings e aplicadas nos próximos envios; salvar não dispara mensagens. Gatilhos descrevem as condições atuais do fluxo; edição de texto não altera aprovação documental ou financeira.
- API restrita ao proprietário confirmado. Limite de 3000 caracteres, mensagens vazias e campos desconhecidos rejeitados, revisão concorrente protegida por updated_at.
- Conversas manuais continuam enviando o texto digitado pelo operador.
- Removido somente o primeiro exemplo, Marcos Oliveira (demo-bahiano-v1-0); os demais exemplos foram preservados.

Validação: typecheck frontend/API, lint, build frontend/API e suíte de testes aprovados. Simulação testa os 17 modelos com gravação, substituição de campos, persistência, restauração, conflitos e isolamento dos envios de demonstração. Os fluxos completos dos dois serviços continuam aprovados.

Playwright no painel publicado confirmou posição na navegação, 17 gatilhos, gravação real, persistência após recarregar, busca e layout móvel. Um webhook autenticado de teste acionou as boas-vindas editadas com nome e valor do cadastro. O atendimento era demonstrativo: nenhuma mensagem externa foi enviada. A personalização temporária e o atendimento de teste foram removidos ao concluir.
