import { describe, expect, it } from "vitest";
import type { ProductionRule, ThenStage } from "../contracts.js";
import { validateRule } from "../validate-rule.js";

function makeRule(overrides: Partial<ProductionRule> = {}): ProductionRule {
	return {
		name: "test-rule",
		when: { "user.age": { $gt: 18 } },
		then: [{ $set: { "user.eligible": true } }] as readonly ThenStage[],
		...overrides,
	};
}

describe("validateRule — syntax level", () => {
	it("rejects rule with empty name", () => {
		expect(() => validateRule(makeRule({ name: "" }), "syntax")).toThrow("non-empty name");
	});

	it("rejects rule with no when clause", () => {
		expect(() => validateRule(makeRule({ when: undefined as unknown as Record<string, unknown> }), "syntax")).toThrow(
			'"when" clause',
		);
	});

	it("rejects rule with empty then array", () => {
		expect(() => validateRule(makeRule({ then: [] }), "syntax")).toThrow("at least one");
	});

	it("rejects rule with __proto__ in action path", () => {
		const rule = makeRule({
			then: [{ $set: { "__proto__.polluted": true } }],
		});
		expect(() => validateRule(rule, "syntax")).toThrow("dangerous path");
	});

	it("accepts valid minimal rule", () => {
		expect(() => validateRule(makeRule(), "syntax")).not.toThrow();
	});
});

describe("validateRule — strict level", () => {
	it("rejects __proto__ in when clause path", () => {
		const rule = makeRule({ when: { "__proto__.x": 1 } });
		expect(() => validateRule(rule)).toThrow("dangerous path");
	});

	it("rejects constructor in nested condition path", () => {
		const rule = makeRule({
			when: { $and: [{ "a.constructor.b": 1 }] },
		});
		expect(() => validateRule(rule)).toThrow("dangerous path");
	});

	it("rejects prototype in else action path", () => {
		const rule = makeRule({
			else: [{ $set: { "a.prototype.b": 1 } }],
		});
		expect(() => validateRule(rule)).toThrow("dangerous path");
	});

	it("rejects non-finite salience (NaN)", () => {
		expect(() => validateRule(makeRule({ salience: Number.NaN }))).toThrow("non-finite salience");
	});

	it("rejects non-finite salience (Infinity)", () => {
		expect(() => validateRule(makeRule({ salience: Number.POSITIVE_INFINITY }))).toThrow("non-finite salience");
	});

	it("accepts valid complex rule with nested conditions", () => {
		const rule = makeRule({
			when: {
				"user.age": { $gt: 18 },
				"user.status": { $eq: "active" },
				"address.city": "NYC",
			},
		});
		expect(() => validateRule(rule)).not.toThrow();
	});

	it("accepts rule with $and/$or containing safe paths", () => {
		const rule = makeRule({
			when: {
				$or: [{ "user.age": { $gt: 18 } }, { $and: [{ "user.role": "admin" }, { "user.verified": true }] }],
			},
		});
		expect(() => validateRule(rule)).not.toThrow();
	});

	it("defers RHS value validation to the authoritative compiler", () => {
		const rule = makeRule({
			then: [{ $set: { x: { $__proto__: "bad" } } }],
		});
		expect(() => validateRule(rule)).not.toThrow();
	});

	it("rejects invalid activationGroup (empty string)", () => {
		expect(() => validateRule(makeRule({ activationGroup: "" }))).toThrow("invalid activationGroup");
	});
});

describe("validateRule — none level", () => {
	it("accepts rule with dangerous paths (no validation)", () => {
		const rule = makeRule({
			when: { "__proto__.x": 1 },
			then: [{ $set: { "__proto__.y": true } }],
		});
		expect(() => validateRule(rule, "none")).not.toThrow();
	});
});

describe("validateRule — integration", () => {
	it("catches prototype pollution in when clause at registration", () => {
		const rule = makeRule({
			when: { $or: [{ "safe.path": 1 }, { "obj.__proto__.polluted": true }] },
		});
		expect(() => validateRule(rule)).toThrow("dangerous path");
	});

	it("does not duplicate bounded RHS canonicalization", () => {
		const rule = makeRule({
			then: [{ $set: { x: { nested: { $__proto__: "bad" } } } }],
		});
		expect(() => validateRule(rule)).not.toThrow();
	});
});
