import fs from "node:fs";
import ts from "typescript";
const result = ts.transpileModule(
  fs.readFileSync("supabase/functions/bahiano-api/index.ts", "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    reportDiagnostics: true,
  },
);
if (result.diagnostics?.length) throw Error("API compilation failed");
fs.mkdirSync("backend/dist", { recursive: true });
fs.writeFileSync("backend/dist/api.mjs", result.outputText);
