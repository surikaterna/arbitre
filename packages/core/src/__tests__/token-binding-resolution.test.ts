import { describe, expect, it } from "vitest";
import type { ProductionRule, SessionConfig } from "../contracts.js";
import { createSession } from "../session.js";

function makeConfig(rules: readonly ProductionRule[]): SessionConfig {
	return {
		factTypes: [
			{ name: "Entry", fields: { weight: "number", nested: "object" } },
			{ name: "Item", fields: { weight: "number", label: "string" } },
		],
		rules,
	};
}

describe("Token Binding Resolution (BETA-2d)", () => {
	it("simple field access: $binding.field resolves from token", () => {
		const rule: ProductionRule = {
			name: "copy-weight",
			when: {},
			then: [{ $set: { "result.weight": "$a.weight" } }],
			patterns: [{ $fact: "Entry", $bind: "a" }],
		};

		const session = createSession(makeConfig([rule]));
		session.assertFact("Entry", { weight: 75, nested: {} });
		session.fire();

		expect(session.getPath("result.weight")).toBe(75);
	});

	it("nested path: $binding.nested.deep.value resolves correctly", () => {
		const rule: ProductionRule = {
			name: "nested-access",
			when: {},
			then: [{ $set: { "result.val": "$a.nested.deep.value" } }],
			patterns: [{ $fact: "Entry", $bind: "a" }],
		};

		const session = createSession(makeConfig([rule]));
		session.assertFact("Entry", { weight: 10, nested: { deep: { value: 42 } } });
		session.fire();

		expect(session.getPath("result.val")).toBe(42);
	});

	it("expression with two bindings: strict $subtract computes difference", () => {
		const rule: ProductionRule = {
			name: "compute-diff",
			when: {},
			then: [{ $set: { diff: { $subtract: ["$top.weight", "$bottom.weight"] } } }],
			patterns: [
				{ $fact: "Item", $bind: "top", $where: { label: "top" } },
				{ $fact: "Item", $bind: "bottom", $where: { label: "bottom" } },
			],
		};

		const session = createSession(makeConfig([rule]));
		session.assertFact("Item", { weight: 100, label: "top" });
		session.assertFact("Item", { weight: 30, label: "bottom" });
		session.fire();

		expect(session.getPath("diff")).toBe(70);
	});

	it("non-pattern rule fallback: $ref resolves from scope", () => {
		const rule: ProductionRule = {
			name: "scope-only",
			when: { "input.x": { $gt: 0 } },
			then: [{ $set: { "output.y": "$input.x" } }],
		};

		const session = createSession({ rules: [rule] });
		session.assert("input.x", 99);
		session.fire();

		expect(session.getPath("output.y")).toBe(99);
	});

	it("binding-scope precedence: token binding wins over scope path", () => {
		const rule: ProductionRule = {
			name: "precedence-check",
			when: {},
			then: [{ $set: { "result.w": "$a.weight" } }],
			patterns: [{ $fact: "Entry", $bind: "a" }],
		};

		const session = createSession(makeConfig([rule]));
		// Set a scope path that looks like it could match "a.weight"
		session.assert("a.weight", 999);
		session.assertFact("Entry", { weight: 7, nested: {} });
		session.fire();

		// Token binding takes precedence
		expect(session.getPath("result.w")).toBe(7);
	});
});
