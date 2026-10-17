import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";

const require = createRequire(import.meta.url);
let ocr;
const maxText = 20000;
const filename = String(workerData.filename || "");
const regions = [];
const probableCNH = (value) => /\bcnh\b|carteira nacional.{0,30}habilita|habilitacao|habilitação/i.test(value);

async function recognize(image) {
  ocr ||= await createWorker("por", 1, { ...require("@tesseract.js-data/por"), cacheMethod: "none" });
  const result = await ocr.recognize(image);
  return { text: (result.data.text || "").slice(0, maxText), confidence: result.data.confidence || 0 };
}
function plainText(items) {
  return items.map((item) => item.str || "").join(" ").slice(0, maxText);
}
function shrinkAndDraw(image, size=1800) {
  const scale = Math.min(1, size / Math.max(image.width, image.height));
  const canvas = createCanvas(Math.ceil(image.width * scale), Math.ceil(image.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}
function cropEnhanced(image, area) {
  const {sx, sy, sw, sh} = area;
  // Read each physical half independently, at OCR-friendly resolution.
  const scale = Math.min(2.6, 1800 / Math.max(sw, sh));
  const canvas = createCanvas(Math.ceil(sw * scale), Math.ceil(sh * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  // Moderate grayscale/contrast enhancement; no external ML service.
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const gray = 0.299 * pixels.data[i] + 0.587 * pixels.data[i+1] + 0.114 * pixels.data[i+2];
    const adjusted = Math.max(0, Math.min(255, 128 + (gray - 128) * 1.4));
    pixels.data[i] = pixels.data[i+1] = pixels.data[i+2] = adjusted;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toBuffer("image/png");
}
async function scanTwoAreas(image, labelPrefix, horizontal) {
  if (image.width < 450 || image.height < 300) return;
  const first = horizontal
    ? { sx: 0, sy: 0, sw: image.width / 2, sh: image.height }
    : { sx: 0, sy: 0, sw: image.width, sh: image.height / 2 };
  const second = horizontal
    ? { sx: image.width / 2, sy: 0, sw: image.width / 2, sh: image.height }
    : { sx: 0, sy: image.height / 2, sw: image.width, sh: image.height / 2 };
  for (const [i, area] of [first, second].entries()) {
    const reading = await recognize(cropEnhanced(image, area));
    regions.push({ area: labelPrefix + "_" + (i + 1), ...reading });
  }
}
async function pageContent(page) {
  const content = await page.getTextContent();
  const text = plainText(content.items);
  if (text.trim().length >= 30) {
    return { text, confidence: 100, method: "pdf_text" };
  }
  const original = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 1800 / Math.max(original.width, original.height));
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext("2d"), viewport, canvas }).promise;
  return { ...(await recognize(canvas.toBuffer("image/png"))), method: "pdf_ocr" };
}
try {
  const bytes = Buffer.from(workerData.bytes);
  let result;
  if (workerData.mime === "application/pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true});
    const pdf = await loadingTask.promise;
    const firstPage = await pdf.getPage(1);
    result = await pageContent(firstPage);
    const isLicense = probableCNH(filename + " " + result.text);
    if (isLicense && pdf.numPages > 1) {
      const second = await pageContent(await pdf.getPage(2));
      regions.push({area:"pdf_page_1",text:result.text,confidence:result.confidence});
      regions.push({area:"pdf_page_2",text:second.text,confidence:second.confidence});
      result.text = (result.text + " " + second.text).slice(0, maxText);
      result.confidence = (result.confidence + second.confidence) / 2;
    } else if (isLicense) {
      const original = firstPage.getViewport({scale:1});
      const scale = Math.min(2, 1600 / Math.max(original.width, original.height));
      const viewport = firstPage.getViewport({scale});
      const canvas = createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
      await firstPage.render({canvasContext:canvas.getContext("2d"),viewport,canvas}).promise;
      await scanTwoAreas(canvas,"pdf_columns",true);
      await scanTwoAreas(canvas,"pdf_rows",false);
    }
    result.pages = pdf.numPages;
    await loadingTask.destroy();
  } else {
    const image = await loadImage(bytes);
    if (image.width * image.height > 20000000) throw Error("Image dimensions too large");
    const canvas = shrinkAndDraw(image);
    result = { ...(await recognize(canvas.toBuffer("image/png"))), method: "image_ocr" };
    if (probableCNH(filename + " " + result.text)) {
      await scanTwoAreas(image, "image_columns",true);
      await scanTwoAreas(image, "image_rows",false);
    }
  }
  result.regions = regions;
  await ocr?.terminate();
  parentPort.postMessage(result);
} catch {
  await ocr?.terminate().catch(() => {});
  parentPort.postMessage({text:"",confidence:0,method:"unreadable",regions:[]});
}
