import {
	type AfterExpression,
	type ArbitreReference,
	type ArbitreValueExpression,
	type BeforeExpression,
	type ElapsedExpression,
	type ProductionRule,
	type RelativeTimeExpression,
	type RuleDependencies,
	type SwitchExpression,
	type WithinExpression,
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

const dependencies: RuleDependencies = {
	conditionReads: [],
	rhsReads: [],
	actionWrites: [],
	actionWritesUnknown: true,
	bindingReads: [],
};
void dependencies;

const switchValue: SwitchExpression = { $switch: { branches: [{ case: "$ready", then: 1 }], default: null } };
const relativeTime: RelativeTimeExpression = { $rtime: "+1d" };
const after: AfterExpression = { $after: ["$createdAt"] };
const before: BeforeExpression = { $before: "$deadline" };
const elapsed: ElapsedExpression = { $elapsed: ["$createdAt", 1_000] };
const within: WithinExpression = { $within: ["$createdAt", 1_000] };
void [switchValue, relativeTime, after, before, elapsed, within];

// @ts-expect-error Switch branches require both case and then.
const invalidSwitch: SwitchExpression = { $switch: { branches: [{ case: true }] } };
// @ts-expect-error Elapsed requires an exact two-item tuple.
const invalidElapsed: ElapsedExpression = { $elapsed: [1] };
// @ts-expect-error Relative time is authored as a primitive string.
const invalidRelativeTime: RelativeTimeExpression = { $rtime: 1 };
void [invalidSwitch, invalidElapsed, invalidRelativeTime];

// @ts-expect-error Structured references require a supported source.
const invalid: ArbitreReference = { source: "global", path: "secret" };
void invalid;

// @ts-expect-error Reference variants are closed at the public type boundary.
const extra: ArbitreReference = { source: "root", path: "safe", extra: true };
void extra;
