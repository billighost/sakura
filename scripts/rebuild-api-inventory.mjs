import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

async function inventory(directory) {
  const rows = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...await inventory(filename));
    else if (entry.name === "route.ts") {
      const source = await readFile(filename, "utf8");
      const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
      const exports = [];
      for (const statement of ast.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name && methods.has(statement.name.text)
          && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
          exports.push({ method: statement.name.text, timed: !!statement.body?.getText(ast).includes("withApiTiming(") });
        } else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            if (methods.has(element.name.text)) exports.push({ method: element.name.text, timed: false });
          }
        } else if (ts.isVariableStatement(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isObjectBindingPattern(declaration.name)) {
              for (const element of declaration.name.elements) {
                if (methods.has(element.name.getText(ast))) exports.push({ method: element.name.getText(ast), timed: false });
              }
            } else if (methods.has(declaration.name.getText(ast))) {
              exports.push({ method: declaration.name.getText(ast), timed: !!declaration.initializer?.getText(ast).includes("withApiTiming(") });
            }
          }
        }
      }
      rows.push({
        route: "/" + path.relative(path.join(root, "src/app"), path.dirname(filename)).replaceAll("\\", "/"),
        file: path.relative(root, filename).replaceAll("\\", "/"),
        methods: exports.sort((a, b) => a.method.localeCompare(b.method)),
      });
    }
  }
  return rows.sort((a, b) => a.route.localeCompare(b.route));
}

const routes = await inventory(path.join(root, "src/app/api"));
const result = {
  routes: routes.length,
  methods: routes.reduce((sum, route) => sum + route.methods.length, 0),
  untimed: routes.flatMap(route => route.methods.filter(method => !method.timed).map(method => `${method.method} ${route.route}`)),
  inventory: routes,
};
if (process.argv.includes("--write")) {
  await writeFile(path.join(root, "docs/rebuild/API-INVENTORY.json"), JSON.stringify(result, null, 2) + "\n");
}
console.log(JSON.stringify({ routes: result.routes, methods: result.methods, untimed: result.untimed }, null, 2));
if (process.argv.includes("--check") && result.untimed.length) process.exitCode = 1;
