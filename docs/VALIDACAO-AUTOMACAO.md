# Fluxo de automação e identificação de anexos

Validação em 11/10/2026 no sistema Bahiano Rei da 99.

## O que mudou

A identificação deixou de depender apenas da legenda. O backend Railway lê imagens com OCR local e extrai o texto da primeira página de PDFs; PDFs escaneados são renderizados para OCR. Nenhum documento é enviado a uma API externa de inteligência artificial. O painel mostra a identificação sugerida e o motivo para conferir o arquivo.

A primeira resposta do interessado move o atendimento para Conversando e orienta os itens faltantes. Um único arquivo não identificado recente pode ser associado a uma identificação posterior, como “RG frente”. A aprovação humana continua obrigatória antes de Produção.

A pausa aplicada pela produção é liberada na finalização para permitir a confirmação de recebimento do comprovante. A pausa manual permanece ativa. Um comprovante reconhecido deixa o serviço em Finalizados, com pagamento pendente; somente entrega registrada e confirmação manual permitem a etapa Pagos.

## Evidência da identificação

Os anexos abaixo são arquivos fictícios com a marca “EXEMPLO FICTÍCIO — SEM VALIDADE”. Foram enviados pelo WhatsApp ao número autorizado e disponibilizados pelo WAHA. A API publicada baixou os arquivos pela rede privada, fez a leitura e gravou o tipo e o resultado no Supabase Storage privado.

| Arquivo | Resultado observado | Forma de identificação |
| --- | --- | --- |
| CNH com indicação de frente | `cnh_frente` | Leitura da imagem |
| CNH com indicação de verso | `cnh_verso` | Leitura da imagem |
| RG com indicação de frente | `rg_frente` | Leitura da imagem |
| RG com indicação de verso | `rg_verso` | Leitura da imagem |
| CRLV com RENAVAM e placa | `crlv` | Leitura da imagem |
| Comprovante Pix concluído, sem legenda | `comprovante` | Leitura da imagem |
| Comprovante em PDF, sem legenda | `comprovante` | Extração de texto do PDF |
| PDF escaneado de comprovante | `comprovante` | Renderização e OCR, teste local reproduzível |
| Pix agendado/pendente | `outro`, com alerta de pendência | Leitura da imagem |
| Solicitação de cobrança/QR Pix | `outro` | Teste do classificador |
| Arquivo desconhecido ou corrompido | Conferência pendente | Não foi identificado como documento válido |
| CNH sem informação suficiente do lado | Solicita frente/verso | Não presume o lado |
| Selfie | Tipo informado na mensagem | Não utiliza OCR para validar rosto ou identidade |

Nos arquivos de imagem legíveis do teste, o OCR retornou confiança de 88% a 94%, e os registros de documentos ficaram disponíveis em aproximadamente 1,2 a 1,6 segundo por arquivo. Esses números descrevem esta amostra fictícia, não a acurácia em qualquer documento real. A leitura não comprova autenticidade, identidade, validade jurídica ou liquidação bancária. PDFs com várias páginas sinalizam que a leitura automática considerou apenas a primeira página.

## Fluxos cobertos

- Uber: primeira mensagem, saudação única, primeira resposta, orientação, seis itens de documentação, rejeição de arquivo desconhecido, aprovação humana, produção, finalização, comprovante pendente, entrega e confirmação manual.
- Documento do carro: mesmo percurso, com RG frente, RG verso e CRLV.
- Comprovante sem legenda: arquivo identificado e serviço mantido em `proof_received`, com `paid_at` vazio até a confirmação manual.
- Proteções: comprovante não transforma o serviço em pago; agendamento e cobrança não são comprovantes concluídos; repetição do webhook não cria outro arquivo ou outra saudação; pausa manual impede respostas automáticas.
- Anexos: armazenamento privado, URL assinada, download real dos bytes e criação/leitura de ZIP.
- Comunicação: o proprietário confirmou que recebeu a resposta “Recebemos o comprovante… O pagamento continua pendente até a confirmação” no número autorizado.

As entradas das jornadas automatizadas foram simuladas por webhooks autenticados. Os arquivos atravessaram o WhatsApp e foram lidos no backend publicado, mas esse teste não representa uma pessoa percorrendo manualmente cada passo no celular. Os registros e arquivos temporários foram removidos; os oito exemplos de apresentação permanecem separados dos dados reais.

## Reprodução

```sh
npm test
npm run test:documents
npm run lint
npm run typecheck
npm run typecheck:api
npm run build
```

Os testes de OCR geram arquivos fictícios em `runtime/fixtures`, ignorados pelo Git. Não use documentos pessoais para reproduzir a suíte. O runtime Railway utiliza leitura local; um deploy independente no Supabase Edge precisa oferecer seu próprio leitor de arquivos e não deve ser usado como webhook alternativo simultâneo.

Referências: [Tesseract.js](https://github.com/naptha/tesseract.js), [renderização PDF.js em Node](https://github.com/mozilla/pdf.js/blob/master/examples/node/pdf2png/pdf2png.mjs), [links e cache de mídia WAHA](https://waha.devlike.pro/docs/how-to/config/).
