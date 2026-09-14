import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const prepare = fileURLToPath(new URL("../scripts/prepare-kuery-expression.mjs", import.meta.url));
const expression = fileURLToPath(new URL("../node_modules/kuery/dist/expression.js", import.meta.url));

execFileSync(process.execPath, [prepare], { cwd: workspaceRoot, stdio: "inherit" });
await writeFile(expression, 'throw new Error("corrupt prepared artifact");\n');
execFileSync(process.execPath, [prepare], { cwd: workspaceRoot, stdio: "inherit" });
const repaired = await readFile(expression, "utf8");
if (repaired.includes("corrupt prepared artifact")) throw new Error("Kuery prepare did not repair corruption.");
const api = await import(`${new URL("../node_modules/kuery/dist/expression.js", import.meta.url)}?smoke=${Date.now()}`);
if (typeof api.compileExpression !== "function") throw new Error("Repaired Kuery expression API is unavailable.");
