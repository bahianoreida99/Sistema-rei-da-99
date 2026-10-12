import http from "node:http";
import { readDocument } from "./document-reader.mjs";
import { metaIntegration } from "./meta-integration.mjs";
globalThis.BahianoReadDocument = readDocument;
const meta = metaIntegration();
globalThis.BahianoMetaRoute = meta.route;
globalThis.BahianoPixelScript = meta.pixelScript;

// Both Railway and Supabase run the same API, with a single webhook target.
globalThis.Deno = {
  env: { get: (key) => process.env[key] },
  serve(handler) {
    const webhookToken =
      process.env.BAHIANO_WEBHOOK_TOKEN || process.env.WEBHOOK_TOKEN;
    if (webhookToken) {
      const timer = setInterval(async () => {
        try {
          await handler(
            new Request("http://localhost/internal/retry", {
              method: "POST",
              headers: { "x-bahiano-webhook-token": webhookToken },
            }),
          );
          await meta.flush();
        } catch {
          console.error("Webhook recovery unavailable");
        }
      }, 30000);
      timer.unref();
    }
    const server = http.createServer(async (incoming, outgoing) => {
      try {
        let size = 0;
        const chunks = [];
        for await (const chunk of incoming) {
          size += chunk.length;
          if (size > 1024 * 1024) {
            outgoing.writeHead(413).end("Request too large");
            return;
          }
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks);
        const request = new Request("http://localhost" + incoming.url, {
          method: incoming.method,
          headers: incoming.headers,
          ...(!["GET", "HEAD"].includes(incoming.method) ? { body } : {}),
        });
        const response = await handler(request);
        outgoing.writeHead(
          response.status,
          Object.fromEntries(response.headers),
        );
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        outgoing.writeHead(500, { "content-type": "application/json" });
        outgoing.end(JSON.stringify({ error: "Falha operacional" }));
      }
    });
    server.requestTimeout = 30000;
    server.headersTimeout = 15000;
    server.listen(Number(process.env.PORT || 3001), "0.0.0.0", () =>
      console.log("Bahiano API listening"),
    );
    for (const signal of ["SIGTERM", "SIGINT"])
      process.on(signal, () => server.close(() => process.exit(0)));
  },
};
await import("./dist/api.mjs");
