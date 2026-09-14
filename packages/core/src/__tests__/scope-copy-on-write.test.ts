import { describe, expect, it } from "vitest";
import { ArbiterError } from "../errors.js";
import { type PreparedProvenanceChange, ScopeProvenance } from "../scope-provenance.js";
import { ScopeStorage } from "../scope-storage.js";
import { ScopeWrites } from "../scope-writes.js";
import { createScopeManager } from "../scope.js";

interface TrapCounts {
	set: number;
	define: number;
	delete: number;
}

describe("scope copy-on-write transactions", () => {
	it("increments without invoking a mutating set trap or changing its target", () => {
		const { proxy, target, counts } = mutationProxy({ count: 1 });
		const scope = seededProxy(proxy);
		scope.inc("holder.count", 1, "inc");
		expect(scope.get("holder.count")).toBe(2);
		expect(target.count).toBe(1);
		expect(counts).toEqual({ set: 0, define: 0, delete: 0 });
	});

	it("merges without invoking a mutating set trap or changing its target", () => {
		const original = { kept: 1 };
		const { proxy, target, counts } = mutationProxy({ config: original });
		const scope = seededProxy(proxy);
		scope.merge("holder.config", { added: 2 }, "merge");
		expect(scope.get("holder.config")).toEqual({ kept: 1, added: 2 });
		expect(target.config).toBe(original);
		expect(original).toEqual({ kept: 1 });
		expect(counts).toEqual({ set: 0, define: 0, delete: 0 });
	});

	it.each([
		["set", (scope: ReturnType<typeof createScopeManager>) => scope.set("holder.value", 2, "rule")],
		["unset", (scope: ReturnType<typeof createScopeManager>) => scope.unset("holder.value", "rule")],
		["push", (scope: ReturnType<typeof createScopeManager>) => scope.push("holder.items", 2, "rule")],
		["inc", (scope: ReturnType<typeof createScopeManager>) => scope.inc("holder.count", 1, "rule")],
		["merge", (scope: ReturnType<typeof createScopeManager>) => scope.merge("holder.config", { added: 2 }, "rule")],
	])("does not invoke set, define, or delete traps for %s", (_, mutate) => {
		const { proxy, counts } = mutationProxy({ value: 1, items: [1], count: 1, config: { kept: 1 } });
		mutate(seededProxy(proxy));
		expect(counts).toEqual({ set: 0, define: 0, delete: 0 });
	});

	it("preserves sparse array length, holes, nested detachment, push, and unset behavior", () => {
		const sparse = new Array(4) as Array<{ value: number } | number | undefined>;
		sparse[2] = { value: 1 };
		const originalNested = sparse[2];
		const scope = createScopeManager({ items: sparse });
		scope.set("items.2.value", 2, "set");
		let items = scope.get("items") as unknown[];
		expect(items).not.toBe(sparse);
		expect(items[2]).not.toBe(originalNested);
		expect(sparse[2]).toEqual({ value: 1 });
		expectSparse(items, 4, [2]);

		scope.push("items", 9, "push");
		items = scope.get("items") as unknown[];
		expect(items[4]).toBe(9);
		expectSparse(items, 5, [2, 4]);

		scope.unset("items.2", "unset");
		items = scope.get("items") as unknown[];
		expectSparse(items, 5, [4]);
	});

	it("detaches traversed null-prototype ancestors and preserves their prototypes", () => {
		const nested = Object.assign(Object.create(null) as Record<string, unknown>, { value: 1 });
		const outer = Object.assign(Object.create(null) as Record<string, unknown>, { nested });
		const scope = createScopeManager({ outer });
		scope.set("outer.nested.value", 2, "set");
		const result = scope.get("outer") as Record<string, Record<string, unknown>>;
		expect(result).not.toBe(outer);
		expect(result.nested).not.toBe(nested);
		expect(Object.getPrototypeOf(result)).toBeNull();
		expect(Object.getPrototypeOf(result.nested)).toBeNull();
		expect(nested.value).toBe(1);
	});

	it("drops inherited values and preserves primitive and missing replacement semantics", () => {
		const inherited = Object.create({ value: 40 }) as Record<string, unknown>;
		const scope = createScopeManager({ inherited, primitive: 1 });
		scope.inc("inherited.value", 2, "inc");
		scope.set("primitive.child", true, "set");
		scope.set("missing.child", true, "set");
		expect(scope.get("inherited.value")).toBe(2);
		expect(scope.get("primitive")).toEqual({ child: true });
		expect(scope.get("missing")).toEqual({ child: true });
		expect(inherited.value).toBe(40);
	});

	it("rejects accessors without invoking them or changing cache and provenance", () => {
		let reads = 0;
		const holder = Object.defineProperty({}, "value", {
			enumerable: true,
			get: () => {
				reads++;
				return 1;
			},
		});
		const scope = seededProxy(holder);
		const cache = scope.getReadView();
		expect(() => scope.set("holder.value", 2, "set")).toThrow("descriptor-safe");
		expect(reads).toBe(0);
		expect(scope.getReadView()).toBe(cache);
		expect(scope.getWriteRecords("set")).toEqual([]);
	});

	it.each(["descriptor", "prototype"])("redacts SECRET from inc/merge %s trap failures", (trap) => {
		const target = Object.defineProperty({}, "count", { configurable: true, enumerable: true, value: 1 });
		const proxy = throwingReflectionProxy(target, trap);
		const scope = seededProxy(proxy);
		const cache = scope.getReadView();
		for (const [rule, action] of [
			["inc", () => scope.inc("holder.count", 1, "inc")],
			["merge", () => scope.merge("holder.count", {}, "merge")],
		] as const) {
			const error = captureArbiterError(action);
			expect(error.code).toBe("ARBITER_EXPRESSION_EVALUATION_FAILED");
			expect(JSON.stringify(error)).not.toContain("SECRET");
			expect(error.details).toEqual({ ruleName: rule, path: "holder.count", reason: expect.any(String) });
			expect(scope.getWriteRecords(rule)).toEqual([]);
		}
		expect(scope.getReadView()).toBe(cache);
		expect(target.count).toBe(1);
	});

	it("supports a proxy reporting a valid shape by materializing it", () => {
		const target = { nested: { value: 1 } };
		const proxy = new Proxy(target, {});
		const scope = seededProxy(proxy);
		scope.set("holder.nested.value", 2, "set");
		expect(scope.get("holder.nested.value")).toBe(2);
		expect(target.nested.value).toBe(1);
	});

	it("rejects nested class writes while retaining untouched opaque aliases", () => {
		class Opaque {
			value = 1;
		}
		const opaque = new Opaque();
		const scope = createScopeManager({ changed: { value: 1 }, opaque });
		expect(() => scope.set("opaque.value", 2, "bad")).toThrow("descriptor-safe");
		scope.set("changed.value", 2, "good");
		expect(scope.get("opaque")).toBe(opaque);
		expect(opaque.value).toBe(1);
	});

	it("shares an untouched uninspectable leaf through checkpoint restore", () => {
		const target = Object.defineProperty({}, "value", { configurable: true, enumerable: true, value: 1 });
		const opaque = throwingReflectionProxy(target, "descriptor");
		const scope = createScopeManager({ changed: 1, opaque });
		const snapshot = scope.snapshot();
		scope.set("changed", 2, "rule");
		scope.restore(snapshot);
		expect(scope.get("changed")).toBe(1);
		expect(scope.get("opaque")).toBe(opaque);
	});

	it("keeps all paths and provenance unchanged when a rule revert cannot be prepared", () => {
		const scope = createScopeManager({ a: { value: 1 }, b: { value: 1 } });
		scope.set("a.value", 2, "rule");
		scope.set("b.value", 2, "rule");
		Object.defineProperty(scope.get("b") as object, "blocked", { enumerable: true, get: () => "SECRET" });
		const cache = scope.getReadView();
		expect(() => scope.revertRule("rule")).toThrow("descriptor-safe");
		expect(scope.get("a.value")).toBe(2);
		expect(scope.get("b.value")).toBe(2);
		expect(scope.getWriteRecords("rule")).toHaveLength(2);
		expect(scope.getReadView()).toBe(cache);
	});

	it("keeps state, cache, and provenance unchanged when restore preparation fails", () => {
		const scope = createScopeManager({ value: 1 });
		const snapshot = scope.snapshot() as Record<string, Record<string, unknown>>;
		scope.set("value", 2, "rule");
		Object.defineProperty(snapshot.root, "blocked", { enumerable: true, get: () => "SECRET" });
		const cache = scope.getReadView();
		expect(() => scope.restore(snapshot)).toThrow("descriptor-safe");
		expect(scope.get("value")).toBe(2);
		expect(scope.getWriteRecords("rule")).toHaveLength(1);
		expect(scope.getReadView()).toBe(cache);
	});

	it("rolls storage and provenance back if provenance append unexpectedly fails", () => {
		class FailingProvenance extends ScopeProvenance {
			override commit(prepared: PreparedProvenanceChange): () => void {
				super.commit(prepared);
				throw new Error("append failed");
			}
		}
		const storage = new ScopeStorage({ value: 1 });
		const provenance = new FailingProvenance();
		const writes = new ScopeWrites(storage, provenance);
		const cache = storage.getReadView();
		expect(() => writes.set("value", 2, "rule")).toThrow("append failed");
		expect(storage.read("value")).toBe(1);
		expect(storage.getReadView()).toBe(cache);
		expect(provenance.getWriteRecords("rule")).toEqual([]);
	});
});

function mutationProxy<T extends Record<string, unknown>>(target: T): { proxy: T; target: T; counts: TrapCounts } {
	const counts = { set: 0, define: 0, delete: 0 };
	const proxy = new Proxy(target, {
		set: (object, key, value) => {
			counts.set++;
			return Reflect.set(object, key, value);
		},
		defineProperty: (object, key, descriptor) => {
			counts.define++;
			return Reflect.defineProperty(object, key, descriptor);
		},
		deleteProperty: (object, key) => {
			counts.delete++;
			return Reflect.deleteProperty(object, key);
		},
	});
	return { proxy, target, counts };
}

function seededProxy(holder: object): ReturnType<typeof createScopeManager> {
	const scope = createScopeManager();
	scope.set("holder", holder, "seed");
	scope.clearWriteRecords("seed");
	return scope;
}

function throwingReflectionProxy(target: object, trap: string): object {
	return new Proxy(target, {
		getOwnPropertyDescriptor:
			trap === "descriptor"
				? () => {
						throw new Error("SECRET");
					}
				: undefined,
		getPrototypeOf:
			trap === "prototype"
				? () => {
						throw new Error("SECRET");
					}
				: undefined,
	});
}

function expectSparse(value: unknown[], length: number, populated: readonly number[]): void {
	expect(value).toHaveLength(length);
	for (let index = 0; index < length; index++) expect(index in value).toBe(populated.includes(index));
}

function captureArbiterError(action: () => unknown): ArbiterError {
	try {
		action();
		throw new Error("Expected action to fail");
	} catch (error) {
		expect(error).toBeInstanceOf(ArbiterError);
		return error as ArbiterError;
	}
}
