import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "arbitre-pack-consumer-"));
const entries = ["@arbitre/core", "@arbitre/core/testing", "@arbitre/core/debug"];
const names = ["createSession", "createTestSession", "explainResult"];

function run(command, args, cwd = temp) {
	return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function checkPack(pack) {
	const files = new Set(pack.files.map(({ path }) => path));
	const manifest = JSON.parse(readFileSync(join(temp, "node_modules/@arbitre/core/package.json"), "utf8"));
	for (const entry of [".", "./testing", "./debug"]) {
		for (const condition of ["import", "require"]) {
			for (const target of Object.values(manifest.exports[entry][condition])) {
				assert(files.has(target.replace(/^\.\//, "")), `Missing packed export target ${entry} ${condition}: ${target}`);
			}
		}
	}
	// Every relative declaration reference must have a sibling declaration in the native tarball.
	for (const file of files) {
		if (!/\.d\.(?:ts|cts)$/.test(file)) continue;
		const declaration = readFileSync(join(temp, "node_modules/@arbitre/core", file), "utf8");
		for (const [, reference] of declaration.matchAll(/(?:from\s*|import\s*\()\s*["'](\.[^"']+)["']/g)) {
			const target = posix
				.normalize(posix.join(posix.dirname(file), reference))
				.replace(/\.(?:c?js)$/, file.endsWith(".d.cts") ? ".d.cts" : ".d.ts");
			assert(files.has(target), `Missing transitive declaration ${file} -> ${target}`);
		}
	}
	console.log(`Native pack: ${files.size} files; all export targets and declaration references present`);
}

function checkTypes() {
	const tsc = join(temp, "node_modules/typescript/bin/tsc");
	const imports = entries
		.map((entry, i) => `import * as m${i} from "${entry}"; export const f${i} = m${i}.${names[i]};`)
		.join("\n");
	writeFileSync(join(temp, "consumer.mts"), imports);
	writeFileSync(join(temp, "consumer.cts"), imports);
	writeFileSync(
		join(temp, "require.cts"),
		entries.map((entry, i) => `import m${i} = require("${entry}"); export const f${i} = m${i}.${names[i]};`).join("\n"),
	);
	for (const [mode, file, extension] of [
		["NodeNext", "consumer.mts", "d.ts"],
		["NodeNext", "consumer.cts", "d.cts"],
		["NodeNext", "require.cts", "d.cts"],
		["Bundler", "consumer.mts", "d.ts"],
	]) {
		const trace = run(process.execPath, [
			tsc,
			"--strict",
			"--noEmit",
			"--skipLibCheck",
			"false",
			"--target",
			"ES2022",
			"--module",
			mode === "Bundler" ? "ESNext" : "NodeNext",
			"--moduleResolution",
			mode,
			"--traceResolution",
			file,
		]);
		for (const entry of entries) {
			const suffix = entry.split("/").slice(2).join("/");
			const target = suffix ? `${suffix}/index.${extension}` : `index.${extension}`;
			assert(
				trace.includes(
					`Module name '${entry}' was successfully resolved to '${join(temp, "node_modules/@arbitre/core/dist", target)}'`,
				),
				`${file} did not resolve ${entry} to ${target}`,
			);
		}
		assert(/contracts-[^\s'"/]+\.d\.(?:cts|ts)/.test(trace), `${file} missed transitive contracts declarations`);
		if (extension === "d.cts")
			assert(!/contracts-[^\s'"/]+\.d\.ts['"]/.test(trace), "CJS selected ESM contracts declarations");
		console.log(`${mode} ${file}: ${extension} + contracts transitive resolved, strict check passed`);
	}
}

try {
	const [pack] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", temp], join(root, "packages/core")));
	run("npm", ["install", "--no-audit", "--no-fund", "--prefix", temp, join(temp, pack.filename), "typescript@5.7.3"]);
	console.log(
		`Packed consumer kuery: ${JSON.parse(readFileSync(join(temp, "node_modules/kuery/package.json"), "utf8")).version}`,
	);
	checkPack(pack);
	checkTypes();
	// Resolve package imports from the isolated consumer rather than this repository.
	const runtime = `import assert from 'node:assert/strict'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const [entry, name] of ${JSON.stringify(entries.map((entry, i) => [entry, names[i]]))}) {
 const esm = await import(entry); const cjs = require(entry);
 assert.equal(typeof esm[name], 'function'); assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
 if (name === 'createSession') assert.equal(esm.createSession({ rules: [] }).fire().rulesFired, 0);
 if (name === 'createTestSession') assert.equal(cjs.createTestSession([]).fire().rulesFired, 0);
 if (name === 'explainResult') assert.match(esm.explainResult({ rulesFired: 0, cycles: 0, changes: [], warnings: [] }), /Fired 0 rules/);
}
console.log('Node ESM/CJS all three entries: passed');`;
	writeFileSync(join(temp, "runtime.mjs"), runtime);
	console.log(run(process.execPath, ["runtime.mjs"]).trim());
} finally {
	rmSync(temp, { recursive: true, force: true });
}
