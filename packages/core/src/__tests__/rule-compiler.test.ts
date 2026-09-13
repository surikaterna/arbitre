import { describe, expect, it } from "vitest";
import type { ProductionRule } from "../contracts.js";
import { compileRule } from "../rule-compiler.js";

describe("compileRule", () => {
	const baseRule: ProductionRule = {
		name: "test-rule",
		when: { score: { $gt: 10 } },
		then: [{ $set: { result: "pass" } }],
	};

	it("compiles a simple rule with equality condition", () => {
		const rule: ProductionRule = {
			name: "eq-rule",
			when: { status: "active" },
			then: [{ $set: { visible: true } }],
		};
		const compiled = compileRule(rule);
		expect(compiled.name).toBe("eq-rule");
		expect(compiled.condition).toBeDefined();
		expect(compiled.actions).toHaveLength(1);
	});

	it("compiles a rule with $gt, $lt, $in operators", () => {
		const rule: ProductionRule = {
			name: "ops-rule",
			when: { age: { $gt: 18, $lt: 65 }, role: { $in: ["admin", "mod"] } },
			then: [{ $set: { access: "granted" } }],
		};
		const compiled = compileRule(rule);
		expect(compiled.condition).toBeDefined();
	});

	it("compiles a rule with nested conditions ($and, $or)", () => {
		const rule: ProductionRule = {
			name: "nested-rule",
			when: { $or: [{ status: "vip" }, { $and: [{ age: { $gte: 21 } }, { verified: true }] }] },
			then: [{ $set: { tier: "premium" } }],
		};
		const compiled = compileRule(rule);
		expect(compiled.condition).toBeDefined();
	});

	it("sets default salience (0), onConflict (warn), enabled (true)", () => {
		const compiled = compileRule(baseRule);
		expect(compiled.salience).toBe(0);
		expect(compiled.onConflict).toBe("warn");
		expect(compiled.enabled).toBe(true);
	});

	it("hasTms is true for rules without else", () => {
		const compiled = compileRule(baseRule);
		expect(compiled.hasTms).toBe(true);
	});

	it("hasTms is false for rules with else", () => {
		const rule: ProductionRule = {
			...baseRule,
			else: [{ $set: { result: "fail" } }],
		};
		const compiled = compileRule(rule);
		expect(compiled.hasTms).toBe(false);
	});

	it("compiles else actions when present", () => {
		const rule: ProductionRule = {
			...baseRule,
			else: [{ $set: { result: "fail" } }],
		};
		const compiled = compileRule(rule);
		expect(compiled.elseActions).toHaveLength(1);
	});

	it("preserves custom salience and onConflict", () => {
		const rule: ProductionRule = {
			...baseRule,
			salience: 10,
			onConflict: "error",
			enabled: false,
		};
		const compiled = compileRule(rule);
		expect(compiled.salience).toBe(10);
		expect(compiled.onConflict).toBe("error");
		expect(compiled.enabled).toBe(false);
	});

	it("stores source reference", () => {
		const compiled = compileRule(baseRule);
		expect(compiled.source).toBe(baseRule);
	});

	it("throws on missing name", () => {
		const rule = { name: "", when: { a: 1 }, then: [{ $set: { x: 1 } }] };
		expect(() => compileRule(rule)).toThrow("non-empty name");
	});

	it("throws on missing when", () => {
		const rule = { name: "bad", when: null, then: [{ $set: { x: 1 } }] } as unknown as ProductionRule;
		expect(() => compileRule(rule)).toThrow('must have a "when" clause');
	});

	it("throws on missing then", () => {
		const rule = { name: "bad", when: { a: 1 }, then: undefined } as unknown as ProductionRule;
		expect(() => compileRule(rule)).toThrow('must have at least one "then" action');
	});

	it("throws on empty then array", () => {
		const rule: ProductionRule = { name: "bad", when: { a: 1 }, then: [] };
		expect(() => compileRule(rule)).toThrow('must have at least one "then" action');
	});
});
