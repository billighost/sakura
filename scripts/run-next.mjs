import { realpathSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Windows resolves Desktop and desktop to one directory, but Node caches them
// separately. Start Next from the real path so its renderer shares one React.
const root = realpathSync.native(fileURLToPath(new URL("..", import.meta.url)));
const cli = path.join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});
child.once("error", error => {
  console.error("Unable to start Next.js:", error.message);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
