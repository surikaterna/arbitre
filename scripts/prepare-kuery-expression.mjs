import { execFileSync } from "node:child_process";
import { access, copyFile, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../node_modules/kuery/", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
if (!manifest.exports?.["./expression"]) throw new Error("Pinned Kuery expression API is unavailable.");

const declaration = join(packageRoot, "dist/expression.d.ts");
try {
	await access(declaration);
} catch {
	execFileSync(
		process.execPath,
		[
			join(workspaceRoot, "node_modules/typescript/bin/tsc"),
			"--declaration",
			"--emitDeclarationOnly",
			"--outDir",
			"dist-types",
			"--rootDir",
			"src",
			"--composite",
			"false",
			"--declarationMap",
			"false",
		],
		{ cwd: packageRoot, stdio: "inherit" },
	);
	execFileSync(
		process.execPath,
		[
			join(workspaceRoot, "node_modules/tsup/dist/cli-default.js"),
			"src/index.ts",
			"src/collection/index.ts",
			"src/filter-compiler.ts",
			"src/compile.ts",
			"src/evaluator.ts",
			"src/failure-trace.ts",
			"src/operators.ts",
			"src/ast.ts",
			"src/errors.ts",
			"src/safe-path.ts",
			"src/expression/index.ts",
			"--format",
			"esm,cjs",
			"--target",
			"es2022",
			"--out-dir",
			"dist",
			"--clean",
			"--no-config",
		],
		{ cwd: packageRoot, stdio: "inherit" },
	);
	await copyFile(join(packageRoot, "dist-types/index.d.ts"), join(packageRoot, "dist/index.d.ts"));
	const declarations = {
		collection: "collection/index.d.ts",
		filter: "filter-compiler.d.ts",
		compile: "compile.d.ts",
		evaluate: "evaluator.d.ts",
		trace: "failure-trace.d.ts",
		operators: "operators.d.ts",
		ast: "ast.d.ts",
		errors: "errors.d.ts",
		"safe-path": "safe-path.d.ts",
	};
	for (const [entry, source] of Object.entries(declarations))
		await copyFile(join(packageRoot, `dist-types/${source}`), join(packageRoot, `dist/${entry}.d.ts`));
	await copyFile(join(packageRoot, "dist-types/expression/index.d.ts"), declaration);
	const expressionModule = await readFile(join(packageRoot, "dist/expression/index.js"), "utf8");
	await writeFile(join(packageRoot, "dist/expression.js"), expressionModule.replaceAll('from "../', 'from "./'));
	await copyFile(join(packageRoot, "dist/expression/index.cjs"), join(packageRoot, "dist/expression.cjs"));
}
if (!(await stat(declaration)).isFile()) throw new Error("Kuery expression declarations were not prepared.");
