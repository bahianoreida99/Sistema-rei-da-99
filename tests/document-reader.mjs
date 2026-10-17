import fs from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readDocument } from "../backend/document-reader.mjs";

const source = ts.transpileModule(fs.readFileSync("supabase/functions/bahiano-api/index.ts", "utf8") + "\n(globalThis as any).identify = identifyDocument;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { Deno: { env: { get: () => "" }, serve: () => {} }, console, Number, String };
vm.runInNewContext(source, context);
export function fixtureImage(lines) {
  const canvas = createCanvas(1100, 750);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1100, 750);
  ctx.fillStyle = "black";
  ctx.font = "32px Arial";
  ["EXEMPLO FICTICIO - SEM VALIDADE", ...lines].forEach((line, i) => ctx.fillText(line, 45, 65 + i * 68));
  return canvas.toBuffer("image/png");
}
export function fixturePDF(lines) {
  const text = lines.map((line, i) => `1 0 0 1 40 ${760 - i * 40} Tm (${line.replace(/[()\\]/g, "")}) Tj`).join("\n");
  const stream = `BT /F1 18 Tf\n${text}\nET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 850] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = "%PDF-1.4\n";const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf));pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10,"0") + " 00000 n ").join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}
async function scannedPDF(imageBytes) {
  const image = await loadImage(imageBytes);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext("2d").drawImage(image, 0, 0);
  const jpeg = canvas.toBuffer("image/jpeg");
  const stream = "q 550 0 0 375 25 430 cm /Im0 Do Q";
  const objects = [Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 850] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"),Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from("\nendstream")]),Buffer.from(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)];
  const chunks=[Buffer.from("%PDF-1.4\n")],offsets=[0];let length=chunks[0].length;
  objects.forEach((obj,i)=>{offsets.push(length);const part=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),obj,Buffer.from("\nendobj\n")]);chunks.push(part);length+=part.length});
  chunks.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,"0")+" 00000 n ").join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`));return Buffer.concat(chunks);
}
const cases = [
  ["cnh_frente", ["CARTEIRA NACIONAL DE HABILITACAO", "FRENTE", "Nome: Pessoa de Teste", "Registro: 00000000000"]],
  ["cnh_verso", ["CARTEIRA NACIONAL DE HABILITACAO", "VERSO", "Observacoes", "Documento ficticio"]],
  ["rg_frente", ["CARTEIRA DE IDENTIDADE", "REGISTRO GERAL - FRENTE", "Nome: Pessoa de Teste", "Filiacao: Familia Ficticia"]],
  ["rg_verso", ["CARTEIRA DE IDENTIDADE", "REGISTRO GERAL - VERSO", "Data de expedicao: 01/01/2026"]],
  ["crlv", ["CERTIFICADO DE REGISTRO E LICENCIAMENTO", "CRLV - VEICULO", "RENAVAM: 00000000000", "PLACA: TESTE00"]],
  ["comprovante", ["COMPROVANTE DE PAGAMENTO PIX", "Transferencia concluida", "Valor: R$ 150,00", "Recebedor: Pessoa de Teste", "Transacao: TESTE-SEM-VALOR"]],
  ["outro", ["COMPROVANTE PIX AGENDADO", "Transferencia pendente", "Valor: R$ 150,00", "Recebedor: Pessoa de Teste"]],
  ["outro", ["Lista de compras", "Arroz, feijao e frutas", "Este arquivo nao e documento"]],
];
if (process.argv[1]?.endsWith("document-reader.mjs")) {
  fs.mkdirSync("runtime/fixtures", { recursive: true });
  for (const [kind, lines] of cases) {
    const bytes = fixtureImage(lines);
    const read = await readDocument(bytes, "image/png");
    const detected = context.identify(read.text, "", read.confidence, read.method);
    assert.equal(detected.kind, kind, JSON.stringify({ expected: kind, detected, read }));
    fs.writeFileSync(`runtime/fixtures/${kind}-${cases.indexOf(cases.find(row=>row[1]===lines))}.png`, bytes);
    console.log(`PASS real image OCR: ${kind}, confidence ${Math.round(read.confidence)}%`);
  }
  const pdf = fixturePDF(cases[5][1]);fs.writeFileSync("runtime/fixtures/comprovante.pdf", pdf);
  const read = await readDocument(pdf, "application/pdf");
  assert.equal(context.identify(read.text, "", read.confidence, read.method).kind, "comprovante");
  assert.equal(read.method, "pdf_text");
  const scan = await scannedPDF(fixtureImage(cases[5][1]));
  fs.writeFileSync("runtime/fixtures/comprovante-escaneado.pdf", scan);
  const scanned = await readDocument(scan, "application/pdf");
  assert.equal(context.identify(scanned.text, "", scanned.confidence, scanned.method).kind, "comprovante",JSON.stringify(scanned));
  assert.equal(scanned.method,"pdf_ocr");
  const corrupt = await readDocument(Buffer.from("invalid image"), "image/png");
  assert.equal(context.identify(corrupt.text, "", corrupt.confidence, corrupt.method).kind, "outro");
  const unspecified = context.identify("CARTEIRA NACIONAL DE HABILITACAO Nome Registro de pessoa", "", 90, "image_ocr");
  assert.equal(unspecified.kind, "cnh_sem_lado");assert.match(unspecified.identification_note,/frente ou verso/);
  assert.equal(context.identify("PIX QR CODE COBRANCA Valor R$ 150,00 Recebedor Pessoa Teste", "", 95, "image_ocr").kind,"outro");
  assert.equal(context.identify("CARTEIRA DE IDENTIDADE REGISTRO GERAL FRENTE VERSO Nome Filiacao", "RG frente", 95, "image_ocr").kind,"outro");
  assert.equal(context.identify("", "comprovante.png", 0, "unreadable").identification_method,"caption");
  const incident = context.identify("imagem pouco legível", "CNH 01_09_26.jpg", 42, "image_ocr");
  assert.equal(incident.kind, "cnh_sem_lado", "Arquivo CNH real deve aparecer como CNH, mesmo sem lado");
  assert.equal(incident.identification_method, "filename_or_caption");
  assert.match(incident.identification_note, /Confirme frente ou verso/);
  assert.equal(context.identify("", "foto qualquer.jpg", 42, "image_ocr").kind, "outro");
  assert.equal(context.identify("CARTEIRA NACIONAL DE HABILITACAO FRENTE Nome Registro", "", 87, "image_ocr").kind, "cnh_frente");
  assert.equal(context.identify("CARTEIRA NACIONAL DE HABILITACAO VERSO Observacoes", "", 87, "image_ocr").kind, "cnh_verso");
  const batch = await Promise.all(Array.from({length:6},()=>readDocument(fixtureImage(cases[5][1]),"image/png")));
  assert.equal(batch.filter(result=>result.method==="busy").length,1,"OCR queue must be bounded");
  assert.equal(batch.filter(result=>context.identify(result.text,"",result.confidence,result.method).kind==="comprovante").length,5);
  console.log("PASS PDF receipt, corrupt image and ambiguous document side require review");
}
