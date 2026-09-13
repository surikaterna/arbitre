import { describe, expect, it } from "vitest";
import type { ProductionRule } from "../contracts.js";
import { createSession } from "../session.js";

describe("RHS live resolution and dependencies", () => {
	it("resolves each entry immediately before its write", () => {
		const session = createSession({
			initialState: { source: 2 },
			rules: [
				{
					name: "ordered",
					when: {},
					then: [{ $set: { first: "$source", second: { $sum: ["$first", 1] } } }],
				},
			],
		});
		session.fire();
		expect(session.getPath("second")).toBe(3);
	});

	it("preserves live visibility across ordered stages", () => {
		const session = createSession({
			rules: [
				{
					name: "stages",
					when: {},
					then: [{ $set: { first: 4 } }, { $set: { second: { $multiply: ["$first", 2] } } }],
				},
			],
		});
		session.fire();
		expect(session.getPath("second")).toBe(8);
	});

	it("resolves registered namespace references", () => {
		const session = createSession({
			namespaces: [{ name: "$ui" }],
			rules: [{ name: "ns", when: {}, then: [{ $set: { result: "$$ui.value" } }] }],
		});
		session.assert("$ui.value", 9);
		session.fire();
		expect(session.getPath("result")).toBe(9);
	});

	it("resolves valid canonical root and namespace references", () => {
		const session = createSession({
			namespaces: [{ name: "$ui" }],
			initialState: { source: { value: 3 } },
			rules: [
				{
					name: "canonical-refs",
					when: {},
					then: [
						{
							$set: {
								root: { $expression: { kind: "ref", ref: { source: "root", path: "source.value" } } },
								namespace: {
									$expression: { kind: "ref", ref: { source: "namespace", namespace: "$ui", path: "value" } },
								},
							},
						},
					],
				},
			],
		});
		session.assert("$ui.value", 5);
		session.fire();
		expect(session.getPath("root")).toBe(3);
		expect(session.getPath("namespace")).toBe(5);
	});

	it("preserves raw custom stage entries and scope-aware stage handlers", () => {
		const session = createSession({
			initialState: { source: 4 },
			thenOperators: {
				register: () => {},
				has: (name) => name === "$effect",
				get: (name) =>
					name === "$effect"
						? (entries, scope, write) => write("result", `${String(entries.get("value"))}:${String(scope.source)}`)
						: undefined,
			},
			rules: [{ name: "effect", when: {}, then: [{ $effect: { value: "raw" } }] }],
		});
		session.fire();
		expect(session.getPath("result")).toBe("raw:4");
	});

	it("classifies dependencies while only conditions schedule", () => {
		const rule: ProductionRule = {
			name: "deps",
			when: { trigger: true },
			then: [{ $set: { output: "$rhsOnly" } }],
		};
		const session = createSession({ rules: [rule], initialState: { trigger: true, rhsOnly: 1 } });
		expect(session.introspect.getRuleDependencies("deps")).toEqual({
			conditionReads: ["trigger"],
			rhsReads: [{ source: "root", path: "rhsOnly" }],
			actionWrites: ["output"],
			bindingReads: [],
		});
		session.fire();
		session.assert("rhsOnly", 2);
		const result = session.fire();
		expect(result.rulesFired).toBe(0);
		expect(session.getPath("output")).toBe(1);
	});

	it("returns deeply frozen dependency metadata", () => {
		const session = createSession({
			rules: [{ name: "frozen", when: { trigger: true }, then: [{ $set: { output: "$source" } }] }],
		});
		const metadata = session.introspect.getRuleDependencies("frozen")!;
		expect(Object.isFrozen(metadata)).toBe(true);
		expect(Object.isFrozen(metadata.conditionReads)).toBe(true);
		expect(Object.isFrozen(metadata.rhsReads[0])).toBe(true);
		expect(() => (metadata.conditionReads as string[]).push("ghost")).toThrow();
		expect(session.introspect.getRuleDependencies("frozen")?.conditionReads).toEqual(["trigger"]);
	});

	it("registerRule validates and compiles before mutating the network", () => {
		const session = createSession();
		expect(() => session.registerRule({ name: "invalid", when: {}, then: [{ $set: { value: { $wat: 1 } } }] })).toThrow(
			"unknown operator",
		);
		expect(session.introspect.getRegisteredRules()).toEqual([]);
		session.registerRule({ name: "valid", when: {}, then: [{ $set: { value: 1 } }] });
		expect(() => session.registerRule({ name: "valid", when: {}, then: [{ $set: { value: 2 } }] })).toThrow(
			"already registered",
		);
		expect(session.introspect.getRegisteredRules()).toEqual(["valid"]);
		expect(session.introspect.getRuleDependencies("valid")?.actionWrites).toEqual(["value"]);
	});

	it("resolves declared token bindings before root paths", () => {
		const rule: ProductionRule = {
			name: "binding",
			when: {},
			patterns: [{ $fact: "Item", $bind: "item" }],
			then: [{ $set: { result: "$item.price" } }],
		};
		const session = createSession({
			factTypes: [{ name: "Item", fields: { price: "number" } }],
			rules: [rule],
		});
		session.assert("item.price", 999);
		session.assertFact("Item", { price: 7 });
		session.fire();
		expect(session.getPath("result")).toBe(7);
		expect(session.introspect.getRuleDependencies("binding")?.bindingReads).toEqual([
			{ source: "binding", binding: "item", path: "price" },
		]);
	});

	it("resolves a valid canonical declared binding", () => {
		const session = createSession({
			factTypes: [{ name: "Item", fields: { price: "number" } }],
			rules: [
				{
					name: "canonical-binding",
					when: {},
					patterns: [{ $fact: "Item", $bind: "item" }],
					then: [
						{
							$set: {
								result: {
									$expression: { kind: "ref", ref: { source: "binding", binding: "item", path: "price" } },
								},
							},
						},
					],
				},
			],
		});
		session.assertFact("Item", { price: 11 });
		session.fire();
		expect(session.getPath("result")).toBe(11);
	});

	it("supports pure namespaced profile extensions without scope", () => {
		let calls = 0;
		const session = createSession({
			expressions: {
				extensions: [
					{
						name: "app:double",
						arity: 1,
						inputTypes: ["number"],
						resultType: "number",
						execute: ([value]) => {
							calls++;
							return (value as number) * 2;
						},
					},
				],
			},
			rules: [
				{
					name: "custom",
					when: {},
					then: [
						{
							$set: {
								result: { $expression: { kind: "op", op: "app:double", args: [{ kind: "literal", value: 4 }] } },
							},
						},
					],
				},
			],
		});
		expect(calls).toBe(0);
		session.fire();
		expect(session.getPath("result")).toBe(8);
		expect(calls).toBe(1);
	});
});
