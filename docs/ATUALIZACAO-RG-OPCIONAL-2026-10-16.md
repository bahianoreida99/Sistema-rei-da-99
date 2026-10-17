# RG não obrigatório — atualização de 16/10/2026

O RG não deve ser solicitado nem bloquear os atendimentos existentes ou novos.

| Serviço | Documentos obrigatórios |
| --- | --- |
| Cadastro Uber | CNH frente, CNH verso, CRLV, selfie, telefone e e-mail |
| Documento do carro | CRLV, telefone e e-mail |

RG frente/verso continuam sendo tipos aceitos para consulta de arquivos antigos ou enviados espontaneamente, mas não são obrigatórios. Não excluir nem migrar dados antigos. A lista de faltantes, a mensagem inicial e a transição para Produção são obtidas da lista atualizada na API compartilhada em `supabase/functions/bahiano-api/index.ts`. O frontend usa a mesma lista. `backend/railway-function.ts` é apenas código legado e também recebeu remoção do requisito.

Antes de considerar a atualização concluída em produção, verificar os testes e o deploy da API Railway e do painel; a atualização do repositório, isoladamente, não garante a aplicação em todos os serviços.
