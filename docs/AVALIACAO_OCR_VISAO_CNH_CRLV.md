# Reconhecimento de CNH e CRLV — avaliação de OCR visual

## Projeto aberto pesquisado
- PaddleOCR: https://github.com/PaddlePaddle/PaddleOCR (Apache-2.0)
- Inclui reconhecimento visual de textos e estrutura de imagens/PDFs. Não vem treinado especificamente para distinguir com garantia os documentos brasileiros por tipo, lado e autenticidade.

## Modelo de integração seguro
1. Manter o arquivo no bucket privado do Supabase, não usar sites públicos para analisar arquivos reais.
2. Quando viável, executar OCR em serviço privado no mesmo projeto Railway, com autenticação entre serviços e retenção mínima. Isso exigiria um serviço adicional, recursos de CPU/memória, avaliação de custo e testes com amostras autorizadas.
3. Converter o resultado OCR em uma classificação sujeita a revisão:
   - CNH digital: um arquivo pode reunir as duas faces; marcar como cnh_completa na coleta somente se identificado como digital ou por evidência de ambas as faces. Sem verificação de autenticidade.
   - CNH fotografada: cnh_frente e cnh_verso conforme o conteúdo efetivamente legível; sem adivinhar se a imagem estiver ambígua.
   - CRLV: procurar indicadores como CRLV, licenciamento, RENAVAM, placa e veículo.
   - Selfie: identificação por contexto/imagem, não por OCR textual.
4. Não converter OCR ou nome do arquivo em documento verificado, pagamento confirmado ou aprovação oficial.
5. Reunir um conjunto de imagens de teste *sintéticas ou autorizadas e minimizadas*, medindo erros por classe (CNH digital, CNH frente, CNH verso, CRLV, selfie, imagem ilegível).
6. Comparar com o Tesseract.js já implantado antes de provisionar um serviço pago de visão.

## Mudança imediata entregue separadamente
O fluxo de atendimento recebe fotos e PDFs silenciosamente, reinicia o relógio a cada atividade e só pergunta após 5 minutos sem novos envios. A resposta SIM registra que o cliente terminou. O áudio final existente afirma que tudo foi entregue: por isso só é enviado se as classes obrigatórias e e-mail estiverem registrados; caso contrário, segue à revisão humana com uma confirmação em texto.

## Limitação dos testes
Simulações verificam tratamento da mensagem, fila, documentação e WAHA simulado. Elas não são prova de acurácia da visão com fotos reais nem teste de entrega em um WhatsApp real.