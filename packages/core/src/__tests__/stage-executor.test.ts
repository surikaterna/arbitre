import { compile } from "kuery/compile";
import { describe, expect, it } from "vitest";
import { createAgenda } from "../agenda.js";
import type { CompiledStage, ThenOperatorRegistry } from "../contracts.js";
import { compileArbitreValue } from "../expression-lower.js";
import { arbitreV1 } from "../expression-profile.js";
import { createScopeManager } from "../scope.js";
import { type StageExecContext, executeStages } from "../stage-executor.js";

function makeCtx(
	initialState?: Record<string, unknown>,
	opts?: { thenOperators?: ThenOperatorRegistry },
): StageExecContext {
	return {
		scope: createScopeManager(initialState),
		agenda: createAgenda(),
		thenOperators: opts?.thenOperators,
	};
}

function stage(operator: string, entries: Record<string, unknown>): CompiledStage {
	const compiled = ["$set", "$inc", "$push", "$merge"].includes(operator)
		? Object.entries(entries).map(([path, value]) => [
				path,
				compileArbitreValue(value, {
					bindings: new Set(),
					namespaces: new Set(["$meta"]),
					profile: arbitreV1,
					ruleName: "r1",
				}),
			])
		: Object.entries(entries);
	return { operator, entries: new Map(compiled) };
}

// ---------------------------------------------------------------------------
// $set
// ---------------------------------------------------------------------------

describe("$set operator", () => {
	it("should set a value at a path in scope", () => {
		const ctx = makeCtx();
		const changes = executeStages([stage("$set", { name: "Alice" })], "r1", ctx);
		expect(ctx.scope.get("name")).toBe("Alice");
		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({ path: "name", previousValue: undefined, newValue: "Alice", ruleName: "r1" });
	});

	it("should overwrite an existing value", () => {
		const ctx = makeCtx({ name: "Bob" });
		const changes = executeStages([stage("$set", { name: "Alice" })], "r1", ctx);
		expect(changes[0]!.previousValue).toBe("Bob");
		expect(ctx.scope.get("name")).toBe("Alice");
	});

	it("should set namespaced paths", () => {
		const ctx = makeCtx();
		executeStages([stage("$set", { "$ui.panel.visible": true })], "r1", ctx);
		expect(ctx.scope.get("$ui.panel.visible")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// $unset
// ---------------------------------------------------------------------------

describe("$unset operator", () => {
	it("should remove a value from scope", () => {
		const ctx = makeCtx({ name: "Alice" });
		const changes = executeStages([stage("$unset", { name: true })], "r1", ctx);
		expect(ctx.scope.get("name")).toBeUndefined();
		expect(changes[0]!.previousValue).toBe("Alice");
		expect(changes[0]!.newValue).toBeUndefined();
	});

	it("should handle unsetting a non-existent path gracefully", () => {
		const ctx = makeCtx();
		const changes = executeStages([stage("$unset", { missing: true })], "r1", ctx);
		expect(changes).toHaveLength(1);
		expect(changes[0]!.previousValue).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// $inc
// ---------------------------------------------------------------------------

describe("$inc operator", () => {
	it("should increment an existing numeric value", () => {
		const ctx = makeCtx({ count: 5 });
		const changes = executeStages([stage("$inc", { count: 3 })], "r1", ctx);
		expect(ctx.scope.get("count")).toBe(8);
		expect(changes[0]!.previousValue).toBe(5);
		expect(changes[0]!.newValue).toBe(8);
	});

	it("should treat missing path as zero", () => {
		const ctx = makeCtx();
		executeStages([stage("$inc", { count: 1 })], "r1", ctx);
		expect(ctx.scope.get("count")).toBe(1);
	});

	it("should increment by negative values", () => {
		const ctx = makeCtx({ count: 10 });
		executeStages([stage("$inc", { count: -3 })], "r1", ctx);
		expect(ctx.scope.get("count")).toBe(7);
	});
});

// ---------------------------------------------------------------------------
// $push
// ---------------------------------------------------------------------------

describe("$push operator", () => {
	it("should push to an existing array", () => {
		const ctx = makeCtx({ items: [1, 2] });
		executeStages([stage("$push", { items: 3 })], "r1", ctx);
		expect(ctx.scope.get("items")).toEqual([1, 2, 3]);
	});

	it("should create an array when path is undefined", () => {
		const ctx = makeCtx();
		executeStages([stage("$push", { items: "hello" })], "r1", ctx);
		expect(ctx.scope.get("items")).toEqual(["hello"]);
	});
});

// ---------------------------------------------------------------------------
// $pull
// ---------------------------------------------------------------------------

describe("$pull operator", () => {
	it("should remove matching items from an array", () => {
		const ctx = makeCtx({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] });
		const predicate = compile({ id: 2 });
		executeStages([{ operator: "$pull", entries: new Map([["items", predicate]]) }], "r1", ctx);
		expect(ctx.scope.get("items")).toEqual([{ id: 1 }, { id: 3 }]);
	});

	it("should leave array unchanged when no items match", () => {
		const ctx = makeCtx({ items: [{ id: 1 }] });
		const predicate = compile({ id: 99 });
		executeStages([{ operator: "$pull", entries: new Map([["items", predicate]]) }], "r1", ctx);
		expect(ctx.scope.get("items")).toEqual([{ id: 1 }]);
	});

	it("should skip non-array targets", () => {
		const ctx = makeCtx({ items: "not-array" });
		const predicate = compile({ id: 1 });
		const changes = executeStages([{ operator: "$pull", entries: new Map([["items", predicate]]) }], "r1", ctx);
		expect(changes).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// $merge
// ---------------------------------------------------------------------------

describe("$merge operator", () => {
	it("should deep merge objects", () => {
		const ctx = makeCtx({ config: { a: 1, b: 2 } });
		executeStages([stage("$merge", { config: { b: 3, c: 4 } })], "r1", ctx);
		const result = ctx.scope.get("config") as Record<string, unknown>;
		expect(result.a).toBe(1);
		expect(result.b).toBe(3);
		expect(result.c).toBe(4);
	});

	it("should reject an existing primitive target", () => {
		const ctx = makeCtx({ config: "old" });
		expect(() => executeStages([stage("$merge", { config: { a: 1 } })], "r1", ctx)).toThrow("merge failed for rule");
		expect(ctx.scope.get("config")).toBe("old");
	});
});

// ---------------------------------------------------------------------------
// $focus
// ---------------------------------------------------------------------------

describe("$focus operator", () => {
	it("should set the agenda focus group", () => {
		const ctx = makeCtx();
		const changes = executeStages([stage("$focus", { group: "validation" })], "r1", ctx);
		expect(changes).toHaveLength(0);
		// Focus is set on agenda — no state changes returned
	});
});

// ---------------------------------------------------------------------------
// Custom operators
// ---------------------------------------------------------------------------

describe("custom then operators", () => {
	it("should dispatch to registered custom operator", () => {
		const registry: ThenOperatorRegistry = {
			register: () => {},
			has: (name) => name === "$custom",
			get: (name) => {
				if (name === "$custom") {
					return (entries, _scope, write) => {
						for (const [path, value] of entries) {
							write(path, `custom:${value}`);
						}
					};
				}
				return undefined;
			},
		};
		const ctx = makeCtx({}, { thenOperators: registry });
		const changes = executeStages([stage("$custom", { result: "test" })], "r1", ctx);
		expect(ctx.scope.get("result")).toBe("custom:test");
		expect(changes).toEqual([{ path: "result", previousValue: undefined, newValue: "custom:test", ruleName: "r1" }]);
		expect(ctx.scope.getWriteRecords("r1")).toHaveLength(1);
	});

	it("should throw when operator is unknown and no registry", () => {
		const ctx = makeCtx();
		expect(() => executeStages([stage("$unknown", { x: 1 })], "r1", ctx)).toThrow("Unknown then operator");
	});

	it("should throw when operator is not found in registry", () => {
		const registry: ThenOperatorRegistry = {
			register: () => {},
			has: () => false,
			get: () => undefined,
		};
		const ctx = makeCtx({}, { thenOperators: registry });
		expect(() => executeStages([stage("$notfound", { x: 1 })], "r1", ctx)).toThrow('Unknown then operator "$notfound"');
	});
});
