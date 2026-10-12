import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import assert from "node:assert/strict";
const js = ts.transpileModule(fs.readFileSync("lib/finance.ts", "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const exports = {};
vm.runInNewContext(js, { exports, Number, Boolean });
const base = {
  stage: "pagos",
  payment_status: "confirmed",
  delivered_at: "2026-10-11",
  service: "uber",
  price_cents: 35000,
  source: "site",
  campaign_code: null,
};
let result = exports.finance([base]);
assert.equal(result.received, 35000);
assert.equal(result.bahiano, 27000);
assert.equal(result.commission, 8000);
assert.equal(result.campaign, 0, "Organic website is not campaign attribution");
result = exports.finance([{ ...base, campaign_code: "CAMPAIGN" }]);
assert.equal(result.campaign, 8000);
result = exports.finance([
  { ...base, payment_status: "proof_received", stage: "finalizados" },
]);
assert.equal(result.received, 0);
assert.equal(result.campaign, 0);
assert.equal(result.receivable, 35000);
assert.equal(result.awaitingPayment.length, 1);
result = exports.finance([{ ...base, delivered_at: null }]);
assert.equal(result.received, 0);
const document = {
  ...base,
  service: "documento",
  price_cents: 15000,
  campaign_code: "CAR",
};
result = exports.finance([document]);
assert.equal(result.bahiano, 10000);
assert.equal(result.commission, 5000);
assert.equal(result.campaign, 5000);
assert.equal(result.documentSplitPending, false);
assert.equal(result.received, result.bahiano + result.commission);
result = exports.finance([document], {
  bahiano_cents: 10000,
  campaign_cents: 5000,
});
assert.equal(result.bahiano, 10000);
assert.equal(result.campaign, 5000);
assert.equal(result.documentSplitPending, false);
result = exports.finance([document], {
  bahiano_cents: 10000,
  campaign_cents: 8000,
});
assert.equal(result.documentSplitPending, true);
assert.equal(result.campaign, 0);
console.log(
  "PASS: confirmed revenue, delivery requirement, pending proof, campaign attribution, document split configuration and invalid totals.",
);
assert.equal(exports.financialMonth(new Date("2026-11-01T02:59:59Z")), "2026-10");
assert.equal(exports.financialMonth(new Date("2026-11-01T03:00:00Z")), "2026-11");
const history = [{ ...base, paid_at: "2026-10-31T23:00:00-03:00" }, { ...document, paid_at: "2026-11-01T00:00:00-03:00" }];
assert.equal(exports.finance(history, undefined, "2026-10").received, 35000);
assert.equal(exports.finance(history, undefined, "2026-11").received, 15000);
assert.equal(exports.finance(history, undefined, "2026-12").commission, 0);
assert.equal(exports.finance(history).received, 50000);
console.log("PASS: monthly rollover in Sao Paulo preserves previous payments and unpaid balances.");
