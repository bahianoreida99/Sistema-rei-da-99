FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY scripts/build-api.mjs scripts/build-api.mjs
COPY supabase/functions/bahiano-api/index.ts supabase/functions/bahiano-api/index.ts
RUN node scripts/build-api.mjs

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/backend/dist backend/dist
COPY backend/*.mjs backend/
USER node
EXPOSE 3001
CMD ["node", "backend/server.mjs"]
