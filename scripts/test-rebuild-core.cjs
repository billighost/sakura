/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS runner uses the installed TypeScript compiler. */
// Compile only the new pure core into an isolated temporary directory, then use
// Node's built-in test runner. No server, account, credentials or network required.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");
const sourceDir = path.resolve(__dirname, "../src/rebuild/core");
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "sakura-core-tests-"));
try {
  const files = fs.readdirSync(sourceDir).filter((name) => name.endsWith(".ts"));
  const program = ts.createProgram(files.map((name) => path.join(sourceDir, name)), {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true,
    skipLibCheck: true, noEmit: true,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => sourceDir, getCanonicalFileName: (name) => name, getNewLine: () => "\n",
  }));
  fs.writeFileSync(path.join(outputDir, "package.json"), JSON.stringify({ type: "module" }));
  for (const file of files) {
    const result = ts.transpileModule(fs.readFileSync(path.join(sourceDir, file), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      reportDiagnostics: true,
    });
    const errors = (result.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
    if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, { getCurrentDirectory: () => sourceDir, getCanonicalFileName: (name) => name, getNewLine: () => "\n" }));
    const emitted = result.outputText.replace(/(from\s+["']\.{1,2}\/[^"']+)(["'])/g, "$1.js$2");
    fs.writeFileSync(path.join(outputDir, file.replace(/\.ts$/, ".js")), emitted);
  }
  const result = spawnSync(process.execPath, ["--test", path.join(outputDir, "core.test.js")], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
