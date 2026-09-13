import { describe, expect, test } from "vitest";
import { createAlphaNetwork } from "../alpha-network.js";
import type { CompiledRule, CompiledStage, ProductionRule } from "../contracts.js";

function makeRule(name: string, conditionPaths: string[], actionPaths: string[] = []): CompiledRule {
	// Build a condition ExprNode that references the given paths
	const pathNodes = conditionPaths.map((p) => ({
		kind: "op" as const,
		op: "$eq",
		args: [
			{ kind: "path" as const, path: p },
			{ kind: "literal" as const, value: true },
		],
	}));

	const condition =
		pathNodes.length === 0
			? { kind: "literal" as const, value: true }
			: pathNodes.length === 1
				? pathNodes[0]
				: { kind: "op" as const, op: "$and", args: pathNodes };

	const actions: readonly CompiledStage[] =
		actionPaths.length > 0 ? [{ operator: "$set", entries: new Map(actionPaths.map((p) => [p, true])) }] : [];

	const source: ProductionRule = { name, when: {}, then: [{ $set: { x: 1 } }] };

	return {
		name,
		condition,
		actions,
		salience: 0,
		onConflict: "warn",
		enabled: true,
		hasTms: true,
		source,
		dependencies: { conditionReads: conditionPaths, rhsReads: [], actionWrites: actionPaths, bindingReads: [] },
	};
}

describe("AlphaNetwork", () => {
	test("empty network returns no affected rules", () => {
		const net = createAlphaNetwork();
		expect(net.getAffectedRules("foo")).toEqual([]);
	});

	test("adding a rule makes it findable by its dependency path", () => {
		const net = createAlphaNetwork();
		const rule = makeRule("r1", ["user.age"]);
		net.addRule(rule);
		const affected = net.getAffectedRules("user.age");
		expect(affected).toHaveLength(1);
		expect(affected[0].name).toBe("r1");
	});

	test("multiple rules on same path all returned", () => {
		const net = createAlphaNetwork();
		net.addRule(makeRule("r1", ["status"]));
		net.addRule(makeRule("r2", ["status"]));
		const affected = net.getAffectedRules("status");
		expect(affected).toHaveLength(2);
		const names = affected.map((r) => r.name).sort();
		expect(names).toEqual(["r1", "r2"]);
	});

	test("wildcard rule items.*.weight matches items.0.weight", () => {
		const net = createAlphaNetwork();
		net.addRule(makeRule("r1", ["items.*.weight"]));
		expect(net.getAffectedRules("items.0.weight")).toHaveLength(1);
		expect(net.getAffectedRules("items.1.weight")).toHaveLength(1);
		expect(net.getAffectedRules("items.99.weight")).toHaveLength(1);
	});

	test("wildcard rule does not match unrelated path", () => {
		const net = createAlphaNetwork();
		net.addRule(makeRule("r1", ["items.*.weight"]));
		expect(net.getAffectedRules("items.0.name")).toEqual([]);
		expect(net.getAffectedRules("other.0.weight")).toEqual([]);
		expect(net.getAffectedRules("items.weight")).toEqual([]);
	});

	test("removeRule removes from exact and wildcard indexes", () => {
		const net = createAlphaNetwork();
		net.addRule(makeRule("r1", ["status"]));
		net.addRule(makeRule("r2", ["items.*.x"]));
		expect(net.getAffectedRules("status")).toHaveLength(1);
		expect(net.getAffectedRules("items.0.x")).toHaveLength(1);

		net.removeRule("r1");
		expect(net.getAffectedRules("status")).toEqual([]);

		net.removeRule("r2");
		expect(net.getAffectedRules("items.0.x")).toEqual([]);
	});

	test("getRuleDependencies returns classified dependencies", () => {
		const net = createAlphaNetwork();
		net.addRule(makeRule("r1", ["a", "b"], ["c"]));
		const deps = net.getRuleDependencies("r1");
		expect(deps?.conditionReads).toEqual(["a", "b"]);
		expect(deps?.actionWrites).toEqual(["c"]);
	});

	test("getRuleDependencies returns undefined for unknown rule", () => {
		const net = createAlphaNetwork();
		expect(net.getRuleDependencies("nonexistent")).toBeUndefined();
	});

	test("multi-wildcard a.*.b.*.c works", () => {
		const net = createAlphaNetwork();
		net.addRule(makeRule("r1", ["a.*.b.*.c"]));
		expect(net.getAffectedRules("a.0.b.1.c")).toHaveLength(1);
		expect(net.getAffectedRules("a.x.b.y.c")).toHaveLength(1);
		expect(net.getAffectedRules("a.0.b.1.d")).toEqual([]);
		expect(net.getAffectedRules("a.0.c")).toEqual([]);
	});

	test("does not return duplicate rules for overlapping deps", () => {
		const net = createAlphaNetwork();
		// Rule depends on both 'a' and 'a' (deduped in extraction, but test the network)
		net.addRule(makeRule("r1", ["a"]));
		const affected = net.getAffectedRules("a");
		expect(affected).toHaveLength(1);
	});

	test("removeRule for nonexistent rule is a no-op", () => {
		const net = createAlphaNetwork();
		net.removeRule("nonexistent"); // should not throw
	});
});
