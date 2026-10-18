// Offline, combinatorial stress test for the reply engine. No client messages,
// secrets, external network, real accounts or third-party AI calls.
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const ts=require("typescript");
const source=fs.readFileSync(new URL("../supabase/functions/bahiano-api/index.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},reportDiagnostics:true});
assert.equal(compiled.diagnostics?.length||0,0);
const sandbox={
  Deno:{env:{get:()=>undefined},serve:()=>{}},
  fetch:()=>{throw Error("Real network forbidden in reply matrix");},
  crypto:crypto.webcrypto,URL,Request,Response,AbortSignal,TextEncoder,ArrayBuffer,Uint8Array,
  setTimeout,clearTimeout,console,Date,Math,JSON,String,Number,Boolean,RegExp,Set,Error
};
const {contextualReply,replyVariant,salesGreeting}=vm.runInNewContext(
  compiled.outputText+"\n;({contextualReply,replyVariant,salesGreeting});",sandbox,{timeout:9000}
);
assert.equal(salesGreeting({}),"Opa! Tudo bem? como posso ajudar?");
const samples={
  price:["Quanto custa?","qual valor?","qual o preço","qto fica","preço final","quanto vcs cobram?","valor do serviço?","tem algum custo?","quais os valores?","custa quanto?","qnt fica","quanto é","qual investimento","quanto pra resolver isso?","preços","e o valor?"],
  timing:["Quanto tempo demora?","qual o prazo","fica pronto hoje?","demora muito?","é rápido?","hoje ainda?","tempo de análise","em quantas horas?","prazo pra entregar","quando fica pronto?","preciso urgente","qual a previsão?"],
  guarantee:["É garantido?","tem garantia?","vai dar certo?","garante aprovação?","tenho certeza que funciona?","se não der certo?","qual a taxa de sucesso?","promete liberar?","é certeza?","aprovação garantida?"],
  objection:["achei caro","muito caro!","ta caro demais","não tenho dinheiro","caríssimo","o valor é alto","achei salgado","tá puxado","não posso pagar","cabe desconto? tá muito caro","fora do meu orçamento"],
  documents:["Quais documentos preciso?","quais documentos?","precisa de RG?","preciso mandar selfie?","lista de documentos","quais arquivos?","que papelada envio?","manda a lista","que documentos são necessários?","preciso da CNH?","quero enviar documentos"],
  security:["É seguro?","LGPD","pedem senha?","precisa da senha da Uber?","confiável?","como usam meus dados?","vazamento de dados?","precisa de código de verificação?","vocês precisam de dados pessoais?","tem risco de golpe?"],
  progress:["Como está meu pedido?","tem novidade?","já terminou?","ta pronto?","atualização do processo?","qual o status?","como anda o atendimento?","alguma novidade?","quero acompanhar"],
  payment:["aceita pix?","pago depois?","cartão?","tem parcelamento?","como pagar?","precisa de sinal?","tem adiantamento?","pagamento na entrega?","quais parcelas?"],
  quality:["foto borrada pode?","arquivo não abre","a imagem ficou ilegível","imagem serve?","não consigo enviar arquivo","foto ruim","foto embaçada","print serve?"],
  eligibility:["minha conta Uber está bloqueada?","estou sem EAR, dá pra ajudar?","minha CNH venceu, pode?","conta banida, consegue?","tenho carro fora do ano, e agora?","cadastro recusado, podem analisar?","meu carro está fora do ano?"],
  unlawful:["quero falsificar o CRLV","preciso de um documento falso","dá pra burlar a Uber?","quero adulterar documento","me ajuda a fraudar a verificação?","como forjar documento?"]
};
const expectedPatterns={
 price:/R\$ (?:350|150),00/,
 timing:/prazo|previs|tempo|estimativa|demanda/,
 guarantee:/promet|garant|requisitos|decis|aprov/,
 objection:/valor|preço|pagamento|pagar|atendimento/,
 documents:/CNH|CRLV|documento|Selfie/i,
 security:/senha|c[oó]digo|dados|documentos|arquivos/i,
 progress:/etapa|conferência|análise|atendimento|atualiza/i,
 payment:/pagamento|paga|Pix|entrega/i,
 quality:/foto|imagem|arquivo|reenvia/i,
 eligibility:/Uber|requisitos|plataforma|aprova|conta|situaç/i,
 unlawful:/n[aã]o|irregular|legais/i
};
const leadStates=[
 {service:"uber",conversation_state:"qualify_uber"},
 {service:"uber",conversation_state:"offer_consent"},
 {service:"uber",conversation_state:"collecting_documents"},
 {service:"uber",conversation_state:"awaiting_review"},
 {service:"documento",conversation_state:"qualify_documento"},
 {service:"documento",conversation_state:"offer_consent"},
 {service:"documento",conversation_state:"collecting_documents"},
 {service:"documento",conversation_state:"awaiting_review"},
 {service:"desconhecido",conversation_state:"discover_service"}
];
const prefixes=["","Oi, ","Olá, ","Por favor, ","Me diz: ","Então, ","Ei, ","Pode explicar: "];
let checked=0,recognized=0;const byKind={};const variants={};
const failures=new Set();
for(const [kind,phrases] of Object.entries(samples)){
  byKind[kind]={total:0,recognized:0};
  const unique=new Set();
  for(const phrase of phrases){
    for(let state=0;state<leadStates.length;state++){
      for(let j=0;j<24;j++){
        const text=prefixes[j%prefixes.length]+phrase;
        const lead=leadStates[state];
        checked++;byKind[kind].total++;
        try {
        const a=contextualReply(text,lead,"matrix-"+kind+"-"+state+"-"+j);
        assert.ok(a?.text,"No reply for "+kind+"/"+text);
        recognized++;byKind[kind].recognized++;
        assert.ok(a.kinds.includes(kind) || (kind==="eligibility" && a.kinds.includes("unlawful")),
          "Wrong intent "+kind+"/"+text+" -> "+JSON.stringify(a.kinds));
        assert.ok(a.text.length<1050 && a.text.length>25,"Bad response length "+kind+" "+a.text.length);
        assert.match(a.text,expectedPatterns[kind],"Grounding "+kind+" "+text+" -> "+a.text);
        assert.doesNotMatch(a.text,/aprovamos sua conta|aprovamos a Uber|garantimos (a )?aprovacao|documento falso em|minha chave pix|senha da sua conta/i);
        if(kind==="price" && lead.service!=="desconhecido"){
          assert.match(a.text,new RegExp("R\\$ "+(lead.service==="uber"?"350":"150")+",00"));
        }
        unique.add(a.text);
        }catch(error){failures.add(kind+" / "+phrase+": "+String(error.message));}
      }
    }
  }
  variants[kind]=unique.size;
  if(kind!=="support" && unique.size<3) failures.add(kind+" needs at least three distinct responses");
}
for(let i=0;i<1000;i++){
  const combo=[
    "Quanto custa e qual o prazo?",
    "Qual o valor, tem garantia?",
    "Quanto tempo e quais documentos preciso?",
    "Aceita pix e pago depois?",
    "A conta é bloqueada, quanto custa?",
    "Se eu mandar uma foto ruim, o que faço?",
    "É seguro? Precisa da minha senha?",
    "Minha conta banida tem prazo?",
    "Muito caro. Tem garantia?",
    "Como anda meu pedido? Tem prazo?",
  ][i%10];
  const answer=contextualReply(combo,leadStates[i%leadStates.length],"combo-"+i);
  assert.ok(answer?.text);
  assert.ok(answer.kinds.length>=1&&answer.kinds.length<=3);
  assert.ok(answer.text.length<1050);
  checked++;
}
for(const msg of ["Oi","Opa!","sim","não","pode seguir","vou enviar os documentos","obrigado","Conta Uber","Minha conta Uber está bloqueada"]){
 const ans=contextualReply(msg,leadStates[0],"pure-"+msg);
 if(["Oi","Opa!","sim","não","pode seguir","vou enviar os documentos","obrigado","Conta Uber"].includes(msg))
   assert.equal(ans,null,"Control flow preserved for "+msg);
 checked++;
}
if(failures.size) throw Error("REPLY_MATRIX_FAILURES ("+failures.size+"):\n"+[...failures].slice(0,80).join("\n"));
console.log("REPLY_MATRIX_REPORT "+JSON.stringify({
 totalCases:checked,recognized,uniqueAnswersByIntent:variants,
 intentCoverage:byKind,states:leadStates.length,
 combinedQueries:1000,liveMessagesSent:0,externalModelCalls:0
}));