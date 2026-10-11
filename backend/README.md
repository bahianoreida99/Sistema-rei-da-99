# API Railway

A API principal executa backend/server.mjs em Node.js e usa o código compartilhado supabase/functions/bahiano-api/index.ts. Dockerfile compila esse código sem incluir secrets. Porta: 3001.

railway-function.ts é somente referência do protótipo antigo; não o execute em paralelo. Configure somente um destino de webhook.

Secrets privados são definidos no serviço bahiano-api da Railway. A função Supabase Edge continua disponível como alternativa, mas precisa das mesmas migrations e configurações de WhatsApp; a chave service_role é injetada automaticamente apenas nesse ambiente Edge.

Consulte ../docs/DEPLOYMENT.md para instalação, migração, autenticação, armazenamento privado, reconexão e recuperação de falhas.
