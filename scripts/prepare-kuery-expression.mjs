import { execFileSync } from "node:child_process";
import { copyFile, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = fileURLToPath(new URL("../node_modules/kuery/", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const coreManifestPath = join(workspaceRoot, "packages/core/package.json");
const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));

await verifyPinnedSource();
if (!manifest.exports?.["./expression"]) throw new Error("Pinned Kuery expression API is unavailable.");
await rebuild();
await validateArtifacts();

async function verifyPinnedSource() {
	const coreManifest = JSON.parse(await readFile(coreManifestPath, "utf8"));
	const specification = coreManifest.dependencies?.kuery;
	const match = typeof specification === "string" ? specification.match(/#([0-9a-f]{40})$/) : undefined;
	if (!match) throw new Error("@arbitre/core must pin Kuery to a full commit SHA.");
	const sha = match[1];
	const lock = await readFile(join(workspaceRoot, "bun.lock"), "utf8");
	const tag = (await readFile(join(packageRoot, ".bun-tag"), "utf8")).trim();
	if (!lock.includes(`"kuery": "${specification}"`) || tag !== `surikaterna-kuery-${sha.slice(0, 7)}`) {
		throw new Error("Installed Kuery source does not match the locked full commit SHA.");
	}
}

async function rebuild() {
	await rm(join(packageRoot, "dist"), { force: true, recursive: true });
	await rm(join(packageRoot, "dist-types"), { force: true, recursive: true });
	execFileSync(process.execPath, declarationArgs(), { cwd: packageRoot, stdio: "inherit" });
	execFileSync(process.execPath, bundleArgs(), { cwd: packageRoot, stdio: "inherit" });
	await copyDeclarations();
}

function declarationArgs() {
	return [
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
	];
}

function bundleArgs() {
	const entries = [
		"index",
		"collection/index",
		"filter-compiler",
		"compile",
		"evaluator",
		"failure-trace",
		"operators",
		"ast",
		"errors",
		"safe-path",
		"expression/index",
	];
	return [
		join(workspaceRoot, "node_modules/tsup/dist/cli-default.js"),
		...entries.map((entry) => `src/${entry}.ts`),
		"--format",
		"esm,cjs",
		"--target",
		"es2022",
		"--out-dir",
		"dist",
		"--clean",
		"--no-config",
	];
}

async function copyDeclarations() {
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
	for (const [entry, source] of Object.entries(declarations)) {
		await copyFile(join(packageRoot, `dist-types/${source}`), join(packageRoot, `dist/${entry}.d.ts`));
	}
	await copyFile(join(packageRoot, "dist/collection/index.js"), join(packageRoot, "dist/collection.js"));
	await copyFile(join(packageRoot, "dist/collection/index.cjs"), join(packageRoot, "dist/collection.cjs"));
	for (const [entry, source] of Object.entries({
		filter: "filter-compiler",
		evaluate: "evaluator",
		trace: "failure-trace",
	})) {
		await copyFile(join(packageRoot, `dist/${source}.js`), join(packageRoot, `dist/${entry}.js`));
		await copyFile(join(packageRoot, `dist/${source}.cjs`), join(packageRoot, `dist/${entry}.cjs`));
	}
	await copyFile(join(packageRoot, "dist-types/expression/index.d.ts"), join(packageRoot, "dist/expression.d.ts"));
	const expressionModule = await readFile(join(packageRoot, "dist/expression/index.js"), "utf8");
	await writeFile(join(packageRoot, "dist/expression.js"), expressionModule.replaceAll('from "../', 'from "./'));
	await copyFile(join(packageRoot, "dist/expression/index.cjs"), join(packageRoot, "dist/expression.cjs"));
}

async function validateArtifacts() {
	for (const target of Object.values(manifest.exports).flatMap((entry) => Object.values(entry))) {
		if (!(await stat(join(packageRoot, target))).isFile())
			throw new Error(`Missing prepared Kuery artifact: ${target}`);
	}
	const cacheBust = `?prepared=${Date.now()}`;
	const root = await import(`${pathToFileURL(join(packageRoot, "dist/index.js")).href}${cacheBust}`);
	const expression = await import(`${pathToFileURL(join(packageRoot, "dist/expression.js")).href}${cacheBust}`);
	const require = createRequire(import.meta.url);
	const rootCjs = require(join(packageRoot, "dist/index.cjs"));
	const expressionCjs = require(join(packageRoot, "dist/expression.cjs"));
	if (![root, rootCjs].every((module) => typeof module.compile === "function"))
		throw new Error("Kuery root smoke failed.");
	if (![expression, expressionCjs].every((module) => typeof module.compileExpression === "function")) {
		throw new Error("Kuery expression smoke failed.");
	}
}
