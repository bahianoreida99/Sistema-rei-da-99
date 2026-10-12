# Relatório completo — Sistema Bahiano Rei da 99

Revisão de 11/10/2026. Painel: https://bahiano-painel-production.up.railway.app

## Resultado

Os testes de código, banco, automação e interface passaram nos cenários descritos abaixo. A guia **Configurações** está no canto inferior esquerdo, imediatamente acima de **Sair**. Ela permite alterar o e-mail e a senha da conta e cadastrar o Pixel e o token da Meta sem compartilhar esses dados no chat.

| Área | Situação | Evidência |
| --- | --- | --- |
| Dashboard e Kanban | 🟢 Validado | Seis etapas, exemplos isolados, filtros, conversa e layout móvel |
| Financeiro | 🟢 Validado | Uber R$350 = R$270 Bahiano + R$80 comissão; documento R$150 = R$100 + R$50 |
| WhatsApp | 🟢 Operacional | Sessão WORKING; conectar preserva sessão ativa; QR e desconexão com testes próprios |
| Automação dos dois serviços | 🟢 Validada nos cenários testados | Saudação, primeira resposta, orientação, documentos, produção, finalização, entrega e pagamento |
| Identificação de arquivos | 🟢 Validada com amostras fictícias | OCR de imagens; extração de texto/PDF escaneado; comprovante, agendamento e arquivo desconhecido |
| Banco em tempo real | 🟢 Validado | CRM e histórico de eventos Meta com política de leitura do proprietário |
| Conta e autorização | 🟢 Implementadas e testadas | Identidade estável; troca de e-mail não altera permissão; senha mínima de 8 caracteres |
| Formulários de Configurações | 🟢 Validados | Campos, confirmação de senha, erros, proteção do token e posição na lateral |
| Integração Meta — implementação | 🟢 Implementada e testada | Pixel do site, API de Conversões, fila persistente, IDs estáveis, histórico paginado e proteção dos dados |
| Conexão real com sua Meta | ⚪ Aguardando configuração | O proprietário escolheu informar Pixel/token no painel; não foram usados IDs ou tokens reais de outro projeto |
| Dependências de produção | 🟢 Verificadas | npm audit sem vulnerabilidades conhecidas na revisão |
| Compilação e verificações de código | 🟢 Aprovadas | Lint, TypeScript frontend/API, testes, build frontend e compilação da API |

O status verde da Meta depende de confirmação de recebimento pela própria Meta. A implementação pronta não é apresentada como uma conta externa já conectada.

## Problemas encontrados e corrigidos nesta revisão

1. **Troca de e-mail poderia bloquear o proprietário.** A autorização dependia de um endereço fixo. Agora o banco, a API e o frontend usam a identidade permanente da conta confirmada. A ausência dessa configuração bloqueia o acesso, em vez de aceitar um e-mail como substituto.
2. **Links de confirmação apontavam para localhost.** O Site URL e a lista de redirecionamentos do Supabase foram atualizados para o painel publicado, preservando as demais configurações do projeto.
3. **Política de senha não correspondia ao formulário.** A exigência mínima de 8 caracteres também foi aplicada ao serviço Auth, além da validação da interface.
4. **Texto “paguei” podia parecer comprovante recebido.** A declaração continua pendente e orienta o envio de comprovante. O registro de comprovante recebido exige um arquivo efetivamente registrado.
5. **Legenda de anexo não aceito podia alterar o estado financeiro.** Arquivos não registrados não marcam comprovante recebido apenas por conter palavras como “paguei”.
6. **Dados de contato inválidos podiam passar pela produção.** A API valida e-mail e telefone, e recusa e-mails malformados na edição do atendimento.
7. **Documento rejeitado após a produção não impedia finalização.** A finalização agora revalida os documentos obrigatórios antes de enviar a mensagem de serviço finalizado.
8. **Valor divergente podia ser confirmado.** A confirmação de pagamento verifica o serviço e o preço contratado antes de registrar receita e gerar uma compra na Meta.
9. **Botões e consultas podiam esperar indefinidamente.** Foram acrescentados limites de espera às ações do painel e às chamadas de banco, armazenamento e envio de mensagens.
10. **Resposta antiga podia substituir dados mais recentes.** O painel ignora respostas de consultas ultrapassadas.
11. **Erros de documentos/configurações/conversa eram pouco visíveis.** Falhas de atualização agora são comunicadas, evitando confundir uma consulta malsucedida com ausência de dados.
12. **Não havia integração Meta.** Foram acrescentados configuração protegida, código do Pixel, eventos do funil, entrega com tentativas, histórico e testes.
13. **Conexão externa poderia parecer saudável após falha.** Rejeição de evento retira o status validado; confirmação efetiva de recebimento permite validá-lo novamente. Configuração alterada durante um envio não é sobrescrita pelo resultado de credenciais antigas.
14. **Atualizações de eventos poderiam apagar configurações em edição.** O histórico atualiza em tempo real preservando os campos ainda não salvos. O teste de conexão exige salvar as alterações primeiro.

## O que está disponível

### Operação

- Dashboard com recebimentos, serviços pagos, aguardando pagamento, parte do Bahiano, comissão e conversão.
- Comparação circular de cadastro Uber e documento do carro, com volume e tempo médio.
- Kanban com seis etapas, conversa, documentação, aprovação/rejeição, produção, finalização, entrega e confirmação de pagamento.
- Oito atendimentos fictícios acessíveis por **Ver exemplos**, sem misturar resultados com o financeiro real.
- WhatsApp com **Conectar/Desconectar**, indicação de conexão efetiva e janela de QR de 60 segundos.
- Recuperação de webhooks e proteção contra repetição de eventos já processados.
- Anexos privados, URLs assinadas e download/ZIP.

### Configurações

- E-mail da conta: alteração solicitada pelo Supabase, com confirmação nos endereços exigidos pelo provedor.
- Senha: nova senha e confirmação, com validação e limpeza dos campos após sucesso.
- Meta: ID do Pixel/conjunto de dados, site dos anúncios, token protegido, código de Eventos de Teste e ativação dos envios.
- Testar conexão: envia um evento de teste e exige acknowledgment da Meta, sem criar uma compra fictícia.
- Histórico de eventos: consulta paginada, atualização em tempo real e situação de envio.
- Código para instalar o Pixel no site público dos anúncios, com isolamento por domínio. O painel administrativo não carrega o Pixel.

### Eventos Meta

| Evento | Origem | Regra |
| --- | --- | --- |
| PageView | Navegador do site | Após instalar o código no site configurado |
| WhatsAppClick | Navegador do site | Clique em link do WhatsApp |
| Lead | CRM | Novo atendimento qualificado |
| Contact | CRM | Primeira resposta do interessado |
| DocumentReceived | CRM | Arquivo registrado |
| DocumentVerified | CRM | Conferência humana registrada |
| ProductionStarted | CRM | Entrada em produção |
| ServiceCompleted | CRM | Serviço finalizado |
| ServiceDelivered | CRM | Entrega registrada |
| Purchase | CRM | Pagamento confirmado após entrega; valor bruto e BRL |

Os eventos do CRM são registrados pelo banco na mesma transação da mudança de estado. A fila usa IDs estáveis, mantém erros e tenta novamente com espera progressiva. Eventos com mais de sete dias são preservados no histórico e não enviados como conversões antigas. Nenhum arquivo, texto de conversa, conteúdo OCR, CNH, RG ou comprovante é transmitido à Meta. Telefone/e-mail de correspondência são normalizados e enviados como SHA-256. Exemplos e contatos pessoais são excluídos.

## Testes executados

### Suítes automatizadas

- Fluxos completos de Uber e documento do carro, com seis/três itens obrigatórios.
- Primeira saudação única; resposta posterior; orientação de documentos faltantes; identificação posterior de um arquivo.
- Arquivo desconhecido, tipo/lado ambíguo, arquivo corrompido, cobrança Pix, Pix agendado e comprovante em imagem/PDF.
- Documento recebido não libera produção sozinho; conferência humana obrigatória; rejeição posterior bloqueia finalização.
- Comprovante e declaração verbal não geram pagamento confirmado; arquivo não aceito não gera comprovante; entrega e preço são verificados antes da confirmação.
- Pausa manual preservada; pausa de produção liberada ao finalizar; retomada; atendimento humano.
- Repetição de webhook, recuperação de falha, falha de envio, URL de mídia externa recusada e autorização.
- Leitura real dos arquivos pelo OCR, PDF textual, PDF escaneado e fila limitada de leitura concorrente.
- Token Meta criptografado, token ausente na resposta, dados de correspondência em hash, testes sem compras fictícias, isolamento de domínio e exclusão de exemplos/pessoais.
- Falhas/repetições de entrega Meta, recuperação após correção de credenciais e invalidação do verde após erro.

### Banco real

- Identidade do proprietário continua autorizada após mudança de e-mail dentro de transação de teste seguida de rollback.
- Identidade não autorizada é recusada; tabelas de credenciais não são legíveis pelo navegador.
- Oito eventos do funil gerados em transação controlada; comprovante pendente não gerou Purchase; compra confirmou valor R$350.
- Demonstração não entrou na fila de marketing.
- Histórico Meta recebido em tempo real pelo proprietário; navegador não pode forjar a situação “recebido pela Meta”; acesso anônimo isolado.
- Migrações novas aplicadas e registradas, com políticas existentes preservadas.

### Interface publicada

- Guia Configurações imediatamente acima de Sair, com campos da conta e Meta.
- Senhas diferentes recusadas; ações de senha/e-mail exercitadas com transporte interceptado, sem alterar as credenciais reais.
- Pixel inválido recusado; token limpo após salvar; teste recusado não mostrou verde; teste confirmado mostrou validação.
- Layout móvel sem transbordamento horizontal.
- Dashboard, exemplos, seis colunas, seleção de conversa e atualização em tempo real preservados.

Comandos: `npm test`, `npm run test:documents`, `npm run lint`, `npm run typecheck`, `npm run typecheck:api`, `npm run build`, `npm run build:api` e `npm audit --omit=dev`.

## Para ativar sua Meta

1. Abra **Configurações**, acima de Sair.
2. Preencha o ID do Pixel/conjunto de dados e o token da API de Conversões.
3. Informe o código exibido em Eventos de Teste da Meta, salve e use **Testar conexão**.
4. Ative o envio dos eventos e salve.
5. Para visitas/cliques do site, informe o endereço público e instale o código disponibilizado no próprio site, após autorização de métricas do visitante. Use uma única instalação desse código.

Não é necessário enviar o token pelo chat. Até essa configuração, a integração fica preparada e os eventos operacionais podem ser consultados no histórico, sem afirmar que a Meta recebeu algo que ainda não recebeu.

## Limites da validação

As jornadas automatizadas usam webhooks controlados e arquivos fictícios; não representam qualquer documento/fotografia real nem a autenticação de identidade. OCR não garante validade jurídica, autenticidade ou liquidação bancária. Selfies e lados sem informação suficiente exigem identificação/conferência humana. O registro de pagamentos permanece manual.

A troca de credenciais do proprietário não foi efetivada durante os testes. A confirmação de e-mail depende do provedor e de concluir o link recebido. O transporte Graph foi simulado na suíte; a conta Meta real será validada quando o proprietário cadastrar suas credenciais no painel. Medição do navegador também depende da instalação no site, da autorização do visitante, dos bloqueadores e das regras da Meta.

Não há garantia de entrega exatamente uma vez quando um envio ao WhatsApp é aceito mas sua resposta de rede é perdida. A recuperação e as chaves de ação reduzem repetições, e o histórico deve ser conferido nesses casos ambíguos. O conjunto de testes não substitui uma auditoria de segurança independente ou um teste de carga com volume real.

Referências: [versão do SDK oficial Meta](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/apiconfig.py), [origens de eventos no SDK oficial](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/serverside/action_source.py), [evidência anterior de automação e anexos](VALIDACAO-AUTOMACAO.md).
