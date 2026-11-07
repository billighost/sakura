/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS build uses the installed TypeScript compiler. */
// Keep the deployable worker's recording gates identical to the app's pure core.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const source = path.resolve(__dirname, "../src/rebuild/core");
const output = path.resolve(__dirname, "../worker/rebuild/core");
fs.mkdirSync(output, { recursive: true });
for (const file of fs.readdirSync(source).filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
  const result = ts.transpileModule(fs.readFileSync(path.join(source, file), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const emitted = result.outputText.replace(/(require\(["']\.{1,2}\/[^"']+)(["']\))/g, "$1.js$2");
  fs.writeFileSync(path.join(output, file.replace(/\.ts$/, ".js")),
    "// Generated from src/rebuild/core; run node scripts/build-rebuild-worker.cjs.\n" + emitted);
}
console.log("Updated deployable worker recording core.");
