import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const esm = await import(new URL("../packages/core/dist/index.js", import.meta.url));
const require = createRequire(import.meta.url);
const cjs = require(fileURLToPath(new URL("../packages/core/dist/index.cjs", import.meta.url)));
const kueryRoot = await import("kuery");
const kueryExpression = await import("kuery/expression");

for (const api of [esm, cjs]) {
	const session = api.createSession({
		rules: [{ name: "smoke", when: {}, then: [{ $set: { value: { $sum: [2, 3] } } }] }],
	});
	session.fire();
	if (session.getPath("value") !== 5 || api.arbitreV1.name !== "arbitre-v1") {
		throw new Error("Package smoke failed");
	}
}

const literal = { kind: "literal", value: true };
for (const [compileExpression, profile] of [
	[kueryRoot.compileExpression, kueryExpression.standardV1],
	[kueryExpression.compileExpression, kueryRoot.standardV1],
]) {
	if (!compileExpression(literal, { profile }).ok) throw new Error("Kuery root/subpath profile interop failed");
}
