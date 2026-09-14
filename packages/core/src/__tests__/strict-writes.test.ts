import { describe, expect, it } from "vitest";
import { ArbiterError } from "../errors.js";
import { type ScopeManager, createScopeManager } from "../scope.js";
import { createSession } from "../session.js";

describe("strict $inc writes", () => {
	it("uses zero only when the terminal own property is absent", () => {
		const scope = createScopeManager();
		const inherited = Object.create({ count: 40 }) as Record<string, unknown>;
		scope.set("holder", inherited, "seed");
		scope.clearWriteRecords("seed");
		expect(scope.hasOwn("holder.count")).toBe(false);
		scope.inc("holder.count", 2, "inc");
		expect(scope.get("holder.count")).toBe(2);
		expect(scope.getWriteRecords("inc")).toHaveLength(1);
	});

	it.each([undefined, null, "1", {}, [], Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
		"rejects an existing %s atomically",
		(value) => {
			const scope = preparedScope(value);
			expectWriteFailure(() => scope.inc("count", 1, "inc"), scope, "count", value);
		},
	);

	it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "1", null])(
		"rejects amount %s atomically",
		(amount) => {
			const scope = preparedScope(2);
			expectWriteFailure(() => scope.inc("count", amount, "inc"), scope, "count", 2);
		},
	);

	it("rejects overflow before state or provenance changes", () => {
		const scope = preparedScope(Number.MAX_VALUE);
		expectWriteFailure(() => scope.inc("count", Number.MAX_VALUE, "inc"), scope, "count", Number.MAX_VALUE);
	});

	it("rejects an own accessor as existing without invoking it", () => {
		let reads = 0;
		const holder = Object.defineProperty({}, "count", {
			enumerable: true,
			get: () => {
				reads++;
				return 4;
			},
		});
		const scope = preparedScope(holder, "holder");
		expect(scope.hasOwn("holder.count")).toBe(true);
		const error = captureError(() => scope.inc("holder.count", 1, "inc"));
		expect(error.details).toEqual({
			operator: "$inc",
			ruleName: "inc",
			path: "holder.count",
			reason: "existing value is not a data property",
		});
		expect(reads).toBe(0);
		expect(scope.getWriteRecords("inc")).toEqual([]);
	});

	it("contains descriptor traps without mutation or provenance", () => {
		const holder = new Proxy(
			{},
			{
				getOwnPropertyDescriptor: () => {
					throw new Error("secret");
				},
			},
		);
		const scope = preparedScope(holder, "holder");
		const error = captureError(() => scope.inc("holder.count", 1, "inc"));
		expect(error.details).toEqual({
			operator: "$inc",
			ruleName: "inc",
			path: "holder.count",
			reason: "existing value is not a data property",
		});
		expect(scope.get("holder")).toBe(holder);
		expect(scope.getWriteRecords("inc")).toEqual([]);
	});

	it("redacts commit-path exceptions without claiming hostile proxy rollback", () => {
		const holder = commitThrowingProxy({ count: 1 });
		const scope = preparedScope(holder, "holder");
		const error = captureError(() => scope.inc("holder.count", 1, "inc"));
		expect(error.details).toEqual({
			operator: "$inc",
			ruleName: "inc",
			path: "holder.count",
			reason: "write could not be committed",
		});
		expect(JSON.stringify(error)).not.toContain("SECRET");
	});

	it("applies strict validation to literal and referenced amounts", () => {
		const literal = createSession({
			initialState: { count: 2 },
			rules: [{ name: "literal", when: {}, then: [{ $inc: { count: 3 } }] }],
		});
		literal.fire();
		expect(literal.getPath("count")).toBe(5);

		const referenced = createSession({
			initialState: { count: 2, amount: Number.POSITIVE_INFINITY },
			rules: [{ name: "referenced", when: {}, then: [{ $inc: { count: "$amount" } }] }],
		});
		const error = captureError(() => referenced.fire());
		expect(error.details).toEqual({
			operator: "$inc",
			ruleName: "referenced",
			path: "count",
			reason: "EXPRESSION_INVALID_RESULT",
		});
		expect(referenced.getPath("count")).toBe(2);
	});
});

describe("strict $merge writes", () => {
	it("materializes frozen public-stage values for override and later writes", () => {
		const session = createSession({
			rules: [
				{
					name: "stages",
					when: {},
					then: [
						{ $set: { config: { kept: 1, changed: 1 } } },
						{ $merge: { config: { changed: 2, added: 3 } } },
						{ $set: { "config.added": 4 } },
						{ $merge: { config: { repeated: true } } },
					],
				},
			],
		});
		session.fire();
		const config = session.getPath("config") as Record<string, unknown>;
		expect(config).toEqual({ kept: 1, changed: 2, added: 4, repeated: true });
		for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(config))) {
			expect(descriptor).toMatchObject({ configurable: true, enumerable: true, writable: true });
		}
	});

	it("preserves an existing null prototype through public stages", () => {
		const existing = createSession({
			rules: [{ name: "existing", when: {}, then: [{ $merge: { config: { added: 2 } } }] }],
		});
		existing.assert("config", Object.assign(Object.create(null), { kept: 1 }));
		existing.fire();
		const config = existing.getPath("config") as Record<string, unknown>;
		expect(Object.getPrototypeOf(config)).toBeNull();
		expect({ ...config }).toEqual({ kept: 1, added: 2 });
	});

	it("preserves recursive null prototypes through provenance reversion", () => {
		const nested = Object.assign(Object.create(null) as Record<string, unknown>, { value: 1 });
		const config = Object.assign(Object.create(null) as Record<string, unknown>, { nested });
		const scope = preparedScope(config, "config");
		scope.set("config", { replacement: true }, "writer");
		expect(scope.revertRule("writer")).toEqual(["config"]);
		const restored = scope.get("config") as Record<string, Record<string, unknown>>;
		expect(Object.getPrototypeOf(restored)).toBeNull();
		expect(Object.getPrototypeOf(restored.nested)).toBeNull();
		expect(restored.nested.value).toBe(1);
	});
	it("copies a missing RHS and preserves its null prototype", () => {
		const scope = createScopeManager();
		const rhs = Object.assign(Object.create(null) as Record<string, unknown>, { added: 1 });
		scope.merge("config", rhs, "merge");
		const result = scope.get("config") as Record<string, unknown>;
		expect(result).not.toBe(rhs);
		expect(Object.getPrototypeOf(result)).toBeNull();
		expect(result).toEqual(rhs);
	});

	it("shallow-merges and preserves the existing target prototype", () => {
		const scope = createScopeManager();
		const target = Object.assign(Object.create(null) as Record<string, unknown>, { kept: 1, changed: 1 });
		scope.set("config", target, "seed");
		scope.clearWriteRecords("seed");
		scope.merge("config", { changed: 2 }, "merge");
		const result = scope.get("config") as Record<string, unknown>;
		expect(Object.getPrototypeOf(result)).toBeNull();
		expect({ ...result }).toEqual({ kept: 1, changed: 2 });
	});

	it.each([[], new Date(), /x/, new (class Example {})(), () => 1, null, "object"])(
		"rejects non-plain RHS values atomically",
		(value) => expectMergeFailure(value),
	);

	it("rejects accessors, symbols, non-enumerables, and unsafe keys without reading values", () => {
		let reads = 0;
		const accessor = Object.defineProperty({}, "secret", {
			enumerable: true,
			get: () => {
				reads++;
				return 1;
			},
		});
		const symbol = { safe: 1 } as Record<PropertyKey, unknown>;
		symbol[Symbol("secret")] = 2;
		const nonEnumerable = Object.defineProperty({}, "secret", { enumerable: false, value: 1 });
		const unsafe = Object.defineProperty({}, "__proto__", { enumerable: true, value: { polluted: true } });
		for (const value of [accessor, symbol, nonEnumerable, unsafe, { constructor: 1 }, { prototype: 1 }]) {
			expectMergeFailure(value);
		}
		expect(reads).toBe(0);
		expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
	});

	it("rejects descriptor-unsafe existing targets without invoking getters", () => {
		let reads = 0;
		const accessor = Object.defineProperty({}, "secret", {
			enumerable: true,
			get: () => {
				reads++;
				return 1;
			},
		});
		const symbol = { safe: 1 } as Record<PropertyKey, unknown>;
		symbol[Symbol("secret")] = 2;
		const nonEnumerable = Object.defineProperty({}, "secret", { enumerable: false, value: 1 });
		const unsafe = Object.defineProperty({}, "__proto__", { enumerable: true, value: 1 });
		for (const target of [accessor, symbol, nonEnumerable, unsafe, { constructor: 1 }, { prototype: 1 }]) {
			const scope = preparedScope(target, "config");
			expectWriteFailure(() => scope.merge("config", { added: 1 }, "merge"), scope, "config", target);
		}
		expect(reads).toBe(0);
	});

	it("contains proxy inspection failures for RHS and existing targets", () => {
		const throwing = new Proxy(
			{},
			{
				getPrototypeOf: () => {
					throw new Error("secret");
				},
			},
		);
		expectMergeFailure(throwing);
		const scope = createScopeManager();
		scope.set("config", throwing, "seed");
		scope.clearWriteRecords("seed");
		expectWriteFailure(() => scope.merge("config", {}, "merge"), scope, "config", throwing);
	});

	it("redacts merge commit-path exceptions without exposing their cause", () => {
		const holder = commitThrowingProxy({ config: { kept: 1 } });
		const scope = preparedScope(holder, "holder");
		const error = captureError(() => scope.merge("holder.config", { added: 2 }, "merge"));
		expect(error.details).toEqual({
			operator: "$merge",
			ruleName: "merge",
			path: "holder.config",
			reason: "write could not be committed",
		});
		expect(JSON.stringify(error)).not.toContain("SECRET");
	});

	it.each([[], new Date(), /x/, new (class Existing {})(), () => 1, undefined, null, "old"])(
		"rejects invalid existing targets atomically",
		(value) => {
			const scope = preparedScope(value, "config");
			expectWriteFailure(() => scope.merge("config", { added: 1 }, "merge"), scope, "config", value);
		},
	);
});

function preparedScope(value: unknown, path = "count"): ScopeManager {
	const scope = createScopeManager();
	scope.set(path, value, "seed");
	scope.clearWriteRecords("seed");
	return scope;
}

function expectMergeFailure(value: unknown): void {
	const scope = createScopeManager({ untouched: true });
	expectWriteFailure(() => scope.merge("config", value, "merge"), scope, "config", undefined);
	expect(scope.get("untouched")).toBe(true);
}

function expectWriteFailure(action: () => unknown, scope: ScopeManager, path: string, expected: unknown): void {
	const error = captureError(action);
	expect(error.code).toBe("ARBITER_EXPRESSION_EVALUATION_FAILED");
	const ruleName = error.ruleName;
	expect(["inc", "merge"]).toContain(ruleName);
	expect(error.details).toEqual({ operator: `$${ruleName}`, ruleName, path, reason: expect.any(String) });
	expect(scope.get(path)).toBe(expected);
	expect(scope.getWriteRecords("inc")).toEqual([]);
	expect(scope.getWriteRecords("merge")).toEqual([]);
}

function commitThrowingProxy<T extends Record<string, unknown>>(target: T): T {
	return new Proxy(target, {
		set: () => {
			throw new Error("SECRET commit cause");
		},
	});
}

function captureError(action: () => unknown): ArbiterError {
	try {
		action();
		throw new Error("Expected action to fail");
	} catch (error) {
		expect(error).toBeInstanceOf(ArbiterError);
		return error as ArbiterError;
	}
}
