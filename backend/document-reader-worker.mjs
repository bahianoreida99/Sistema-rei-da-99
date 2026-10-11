import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";
const require = createRequire(import.meta.url);
let ocr;
async function recognize(image) {
  ocr ||= await createWorker("por", 1, { ...require("@tesseract.js-data/por"), cacheMethod: "none" });
  const result = await ocr.recognize(image);
  return { text: result.data.text.slice(0, 20000), confidence: result.data.confidence };
}
try {
  const bytes = Buffer.from(workerData.bytes);
  let result;
  if (workerData.mime === "application/pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str || "").join(" ").slice(0, 20000);
    if (text.trim().length >= 30) result = { text, confidence: 100, method: "pdf_text" };
    else {
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 1800 / Math.max(original.width, original.height));
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext("2d"), viewport, canvas }).promise;
      result = { ...(await recognize(canvas.toBuffer("image/png"))), method: "pdf_ocr" };
    }
    result.pages = pdf.numPages;
    await loadingTask.destroy();
  } else {
    const image = await loadImage(bytes);
    if (image.width * image.height > 20000000) throw Error("Image dimensions too large");
    const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
    const canvas = createCanvas(Math.ceil(image.width * scale), Math.ceil(image.height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    result = { ...(await recognize(canvas.toBuffer("image/png"))), method: "image_ocr" };
  }
  await ocr?.terminate();
  parentPort.postMessage(result);
} catch {
  await ocr?.terminate().catch(() => {});
  parentPort.postMessage({ text: "", confidence: 0, method: "unreadable" });
}
