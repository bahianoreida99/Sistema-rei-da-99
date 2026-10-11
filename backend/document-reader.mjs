import { Worker } from "node:worker_threads";

let busy = false;
const waiting = [];
async function acquire() {
  if (!busy) { busy = true; return true; }
  if (waiting.length >= 4) return false;
  return new Promise((resolve) => {
    const next = () => { clearTimeout(timeout); resolve(true); };
    const timeout = setTimeout(() => {
      const index = waiting.indexOf(next);
      if (index !== -1) waiting.splice(index, 1);
      resolve(false);
    }, 10000);
    waiting.push(next);
  });
}
// Files stay inside the API process; no external OCR service receives them.
export async function readDocument(bytes, mime) {
  if (!await acquire()) return { text: "", confidence: 0, method: "busy" };
  try {
    return await new Promise((resolve) => {
      const worker = new Worker(new URL("./document-reader-worker.mjs", import.meta.url), {
        workerData: { bytes: new Uint8Array(bytes), mime },
        resourceLimits: { maxOldGenerationSizeMb: 192 },
      });
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        void worker.terminate().finally(() => resolve(value));
      };
      const timeout = setTimeout(() => finish({ text: "", confidence: 0, method: "timeout" }), 25000);
      worker.once("message", finish);
      worker.once("error", () => finish({ text: "", confidence: 0, method: "unreadable" }));
      worker.once("exit", () => finish({ text: "", confidence: 0, method: "unreadable" }));
    });
  } finally {
    const next = waiting.shift();
    if (next) next();
    else busy = false;
  }
}
