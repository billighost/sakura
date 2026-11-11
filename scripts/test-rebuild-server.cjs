/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS runner uses the installed TypeScript compiler. */
// Typecheck and test only the new core/server. No credentials or live service access.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");
const repositoryRoot = path.resolve(__dirname, "..");
const sourceRoot = path.resolve(__dirname, "../src/rebuild");
const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sakura-server-tests-"));
try {
  const files = ["requestOrigin.ts", "data/artistSelection.ts", ...["core", "server"].flatMap((dir) => fs.readdirSync(path.join(sourceRoot, dir)).filter((name) => name.endsWith(".ts")).map((name) => path.join(dir, name)))];
  const program = ts.createProgram(files.map((name) => path.join(sourceRoot, name)), { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, noEmit: true });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => sourceRoot, getCanonicalFileName: (name) => name, getNewLine: () => "\n" }));
  fs.writeFileSync(path.join(outputRoot, "package.json"), JSON.stringify({ type: "module" }));
  // Runtime container inspection imports the installed music-metadata package.
  fs.symlinkSync(path.join(repositoryRoot, "node_modules"), path.join(outputRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  // Preserve the repository layout, including shared fixtures imported outside
  // src/rebuild. Flattening into outputRoot/server made ../../../scripts escape
  // the isolated output directory and left the audio fixture uncompiled.
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile) continue;
    const file = path.relative(repositoryRoot, source.fileName);
    if (file.startsWith("..") || path.isAbsolute(file) || file.split(path.sep).includes("node_modules")) continue;
    const result = ts.transpileModule(source.text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
    fs.mkdirSync(path.dirname(path.join(outputRoot, file)), { recursive: true });
    const emitted = result.outputText.replace(/(from\s+["']\.{1,2}\/[^"']+)(["'])/g, "$1.js$2");
    fs.writeFileSync(path.join(outputRoot, file.replace(/\.ts$/, ".js")), emitted);
  }
  const result = spawnSync(process.execPath, ["--test", path.join(outputRoot, "src/rebuild/server/server.test.js")], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally { fs.rmSync(outputRoot, { recursive: true, force: true }); }
