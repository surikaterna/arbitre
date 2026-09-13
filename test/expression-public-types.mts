import {
	type ArbitreReference,
	type ArbitreValueExpression,
	type ProductionRule,
	arbitreV1,
	createSession,
	expression,
	literal,
} from "../packages/core/dist/index.js";

const reference: ArbitreReference = { source: "root", path: "price" };
const canonical: ArbitreValueExpression = { kind: "ref", ref: reference };
const rule: ProductionRule = {
	name: "public-types",
	when: {},
	then: [{ $set: { a: expression(canonical), b: literal({ safe: true }) } }],
};

createSession({
	rules: [rule],
	expressions: {
		extensions: [{ name: "app:constant", arity: 0, execute: () => 1 }],
	},
});

arbitreV1.get("if");

// @ts-expect-error Structured references require a supported source.
const invalid: ArbitreReference = { source: "global", path: "secret" };
void invalid;

// @ts-expect-error Reference variants are closed at the public type boundary.
const extra: ArbitreReference = { source: "root", path: "safe", extra: true };
void extra;
