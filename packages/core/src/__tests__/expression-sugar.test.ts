import { describe, expect, it, vi } from "vitest";
import type { ProductionRule } from "../contracts.js";
import { ArbiterError } from "../errors.js";
import { compileArbitreValue } from "../expression-lower.js";
import { arbitreV1 } from "../expression-profile.js";
import { evaluateArbitreValue } from "../expression-runtime.js";
import { createScopeManager } from "../scope.js";
import { createSession } from "../session.js";

const clock = (now: number) => ({ now: () => now });

describe("$switch expression sugar", () => {
	it("selects the first strict-boolean branch lazily and defaults to null", () => {
		expect(
			run({
				$switch: {
					branches: [
						{ case: false, then: "$missing" },
						{ case: true, then: 2 },
					],
					default: 3,
				},
			}),
		).toBe(2);
		expect(run({ $switch: { branches: [{ case: false, then: 1 }] } })).toBeNull();
	});

	it("does not evaluate unselected throwing, missing, denied, or invalid-result branches", () => {
		const execute = vi.fn(() => {
			throw new Error("not selected");
		});
		const session = createSession({
			expressions: { extensions: [{ name: "app:fail", arity: 0, execute }] },
			rules: [rule({ $switch: { branches: [{ case: true, then: "safe" }], default: canonicalOp("app:fail") } })],
		});
		session.fire();
		expect(session.getPath("result")).toBe("safe");
		expect(execute).not.toHaveBeenCalled();
		expect(
			run({
				$switch: {
					branches: [
						{ case: true, then: "safe" },
						{ case: "$missing", then: 2 },
					],
				},
			}),
		).toBe("safe");
	});

	it("propagates errors from selected results only", () => {
		const selectedMissing = capture(() => run({ $switch: { branches: [{ case: true, then: "$missing" }] } }));
		expect(selectedMissing.details).toEqual({
			diagnosticCode: "EXPRESSION_REFERENCE_MISSING",
			path: ["$switch", "branches", 0, "then"],
		});
		const selectedDenied = compileArbitreValue(
			{ $switch: { branches: [{ case: true, then: "$x.value" }] } },
			{ ...options(), bindings: new Set(["x"]) },
		);
		expect(selectedDenied.expression.evaluate(() => ({ found: false, reason: "denied" }))).toMatchObject({
			ok: false,
			diagnostic: { code: "EXPRESSION_REFERENCE_DENIED" },
		});
		expect(capture(() => evaluateArbitreValue(selectedDenied, createScopeManager(), "sugar")).details).toEqual({
			diagnosticCode: "EXPRESSION_REFERENCE_DENIED",
			path: ["$switch", "branches", 0, "then"],
		});
		const invalid = createSession({
			expressions: { extensions: [{ name: "app:invalid", arity: 0, execute: () => Number.POSITIVE_INFINITY }] },
			rules: [rule({ $switch: { branches: [{ case: true, then: canonicalOp("app:invalid") }] } })],
		});
		expect(capture(() => invalid.fire()).details).toEqual({
			diagnosticCode: "EXPRESSION_INVALID_RESULT",
			path: ["$switch", "branches", 0, "then"],
		});
	});

	it("preserves branch order and collects dependencies from every outcome", () => {
		const compiled = compileArbitreValue(
			{
				$switch: {
					branches: [
						{ case: "$first", then: "$a" },
						{ case: "$second", then: "$b" },
					],
					default: "$c",
				},
			},
			options(),
		);
		expect(compiled.expression.dependencies).toEqual([
			{ source: "root", path: "first" },
			{ source: "root", path: "a" },
			{ source: "root", path: "second" },
			{ source: "root", path: "b" },
			{ source: "root", path: "c" },
		]);
		expect(
			run({
				$switch: {
					branches: [
						{ case: true, then: 1 },
						{ case: true, then: 2 },
					],
				},
			}),
		).toBe(1);
	});

	it("rejects non-boolean selected cases at their authored path", () => {
		const error = capture(() => run({ $switch: { branches: [{ case: 1, then: true }] } }));
		expect(error.details).toEqual({
			diagnosticCode: "EXPRESSION_TYPE_MISMATCH",
			path: ["$switch", "branches", 0, "case"],
		});
	});

	it("maps selected result diagnostics and nested shorthand to authored paths", () => {
		const error = capture(() => run({ $switch: { branches: [{ case: true, then: { $divide: [1, 0] } }] } }));
		expect(error.details).toEqual({
			diagnosticCode: "EXPRESSION_DIVISION_BY_ZERO",
			path: ["$switch", "branches", 0, "then", "$divide"],
		});
	});

	it("passes nested canonical diagnostics through without reading canonical accessors", () => {
		let reads = 0;
		const ast = Object.defineProperty({}, "kind", {
			enumerable: true,
			get: () => {
				reads += 1;
				return "literal";
			},
		});
		const proxied = new Proxy(ast, {
			get(target, key, receiver) {
				reads += 1;
				return Reflect.get(target, key, receiver);
			},
		});
		const error = capture(() =>
			createSession({
				rules: [rule({ $switch: { branches: [{ case: true, then: { $expression: proxied } }] } })],
			}),
		);
		expect(reads).toBe(0);
		expect(error.code).toBe("ARBITER_EXPRESSION_COMPILATION_FAILED");
		expect(error.details).toEqual({
			diagnosticCode: "EXPRESSION_INVALID_INPUT",
			path: ["$switch", "branches", 0, "then", "kind"],
		});
	});

	it("stores collision-free immutable mappings with deterministic nearest ancestors", () => {
		const compiled = compileArbitreValue(
			{ $switch: { branches: [{ case: { $after: "$start" }, then: { $rtime: "+1s" } }], default: 0 } },
			options(),
		);
		const identities = compiled.diagnosticPaths.map((entry) => JSON.stringify(entry.canonical));
		expect(new Set(identities).size).toBe(identities.length);
		expect(Object.isFrozen(compiled.diagnosticPaths)).toBe(true);
		for (const entry of compiled.diagnosticPaths) {
			expect(Object.isFrozen(entry)).toBe(true);
			expect(Object.isFrozen(entry.canonical)).toBe(true);
			expect(Object.isFrozen(entry.authored)).toBe(true);
		}
	});

	it("rejects malformed descriptors without invoking getters", () => {
		let reads = 0;
		const accessor = Object.defineProperty({}, "case", { enumerable: true, get: () => reads++ });
		const symbol = { branches: [{ case: true, then: 1 }] } as Record<PropertyKey, unknown>;
		symbol[Symbol("extra")] = true;
		const sparse = Array(2);
		sparse[0] = { case: true, then: 1 };
		for (const descriptor of [
			null,
			{},
			{ branches: [] },
			{ branches: Array(33).fill({ case: true, then: 1 }) },
			{ branches: sparse },
			symbol,
			{ branches: [accessor] },
			{ branches: [{ case: true, then: 1, extra: true }] },
		]) {
			expect(() => createSession({ rules: [rule({ $switch: descriptor })] })).toThrow(ArbiterError);
		}
		expect(reads).toBe(0);
	});

	it("leaves configured Kuery limits authoritative", () => {
		expect(() =>
			createSession({
				expressions: { limits: { maxDepth: 1 } },
				rules: [
					rule({
						$switch: {
							branches: [
								{ case: false, then: 1 },
								{ case: true, then: 2 },
							],
						},
					}),
				],
			}),
		).toThrow("EXPRESSION_LIMIT_EXCEEDED");
	});
});

describe("$rtime expression sugar", () => {
	it.each([
		["+0ms", 1_000],
		["+1s", 2_000],
		["-2m", -119_000],
		["+3h", 10_801_000],
		["+1d", 86_401_000],
	])("lowers %s with fixed millisecond units", (duration, expected) => {
		expect(run({ $rtime: duration }, {}, 1_000)).toBe(expected);
	});

	it.each(["1s", " 1s", "+01s", "+1.0s", "+1e3ms", "+1w", "+1h30m", "+-1s", "+1S"])(
		"rejects invalid duration %s",
		(duration) =>
			expect(() => createSession({ rules: [rule({ $rtime: duration })] })).toThrow("signed fixed-unit duration"),
	);

	it("rejects non-strings and unsafe multiplied deltas before number conversion", () => {
		expect(() => createSession({ rules: [rule({ $rtime: 1 })] })).toThrow("signed duration string");
		expect(() => createSession({ rules: [rule({ $rtime: "+104249992d" })] })).toThrow("safe integer range");
	});

	it("reports a missing clock through Kuery at the authored operator path", () => {
		const missing = capture(() => run({ $rtime: "+1ms" }));
		expect(missing.details).toEqual({ diagnosticCode: "EXPRESSION_REFERENCE_MISSING", path: ["$rtime"] });
	});

	it("exposes only the structured clock dependency and no profile operator", () => {
		const compiled = compileArbitreValue({ $rtime: "+1s" }, options());
		expect(compiled.expression.dependencies).toEqual([{ source: "namespace", namespace: "$meta", path: "$now" }]);
		expect(arbitreV1.has("rtime")).toBe(false);
		expect(() => createSession({ rules: [rule({ $since: [0, 1] })] })).toThrow("unknown operator $since");
	});
});

describe("temporal predicate sugar", () => {
	it("uses exclusive scalar and singleton-tuple comparisons", () => {
		expect(run({ $after: 1_000 }, {}, 1_000)).toBe(false);
		expect(run({ $after: [999] }, {}, 1_000)).toBe(true);
		expect(run({ $before: 1_000 }, {}, 1_000)).toBe(false);
		expect(run({ $before: [1_001] }, {}, 1_000)).toBe(true);
	});

	it("uses exclusive elapsed and within formulas with direct negative math", () => {
		expect(run({ $elapsed: [900, 100] }, {}, 1_000)).toBe(false);
		expect(run({ $elapsed: [900, 99] }, {}, 1_000)).toBe(true);
		expect(run({ $within: [900, 100] }, {}, 1_000)).toBe(false);
		expect(run({ $within: [900, 101] }, {}, 1_000)).toBe(true);
		expect(run({ $elapsed: [1_100, -101] }, {}, 1_000)).toBe(true);
	});

	it.each(["$after", "$before"])("returns false for missing clock or %s operand", (operator) => {
		expect(run({ [operator]: 1_000 })).toBe(false);
		expect(run({ [operator]: "$missing" }, {}, 1_000)).toBe(false);
	});

	it.each(["$elapsed", "$within"])("returns false for missing %s tuple values", (operator) => {
		expect(run({ [operator]: ["$missing", 10] }, {}, 1_000)).toBe(false);
		expect(run({ [operator]: [0, "$missing"] }, {}, 1_000)).toBe(false);
	});

	it("preserves denied references and reports present wrong types", () => {
		const compiled = compileArbitreValue({ $after: "$x.value" }, { ...options(), bindings: new Set(["x"]) });
		expect(compiled.expression.evaluate(() => ({ found: false, reason: "denied" }))).toMatchObject({
			ok: false,
			diagnostic: { code: "EXPRESSION_REFERENCE_DENIED" },
		});
		const scope = createScopeManager();
		scope.set("$meta.$now", 1_000, "clock");
		expect(capture(() => evaluateArbitreValue(compiled, scope, "sugar")).details).toEqual({
			diagnosticCode: "EXPRESSION_REFERENCE_DENIED",
			path: ["$after"],
		});
		const wrong = capture(() => run({ $elapsed: [0, "text"] }, {}, 1_000));
		expect(wrong.details).toEqual({ diagnosticCode: "EXPRESSION_TYPE_MISMATCH", path: ["$elapsed", 1] });
	});

	it("leaves finite arithmetic overflow to Kuery diagnostics", () => {
		const overflow = capture(() => run({ $elapsed: [-Number.MAX_VALUE, 0] }, {}, Number.MAX_VALUE));
		expect(overflow.details).toEqual({ diagnosticCode: "EXPRESSION_NON_FINITE_RESULT", path: ["$elapsed"] });
	});

	it("rejects malformed aliases and tuples", () => {
		for (const value of [
			{ $after: [] },
			{ $before: [1, 2] },
			{ $elapsed: [1] },
			{ $within: [1, 2, 3] },
			{ $elapsed: Array(2) },
		]) {
			expect(() => createSession({ rules: [rule(value)] })).toThrow(ArbiterError);
		}
	});

	it("collects clock and operand dependencies while profile names remain absent", () => {
		const compiled = compileArbitreValue({ $within: ["$start", "$duration"] }, options());
		expect(compiled.expression.dependencies).toEqual([
			{ source: "namespace", namespace: "$meta", path: "$now" },
			{ source: "root", path: "start" },
			{ source: "root", path: "duration" },
		]);
		for (const name of ["switch", "rtime", "after", "before", "elapsed", "within"])
			expect(arbitreV1.has(name)).toBe(false);
	});
});

describe("clock integration for expression sugar", () => {
	it("reads a configured clock once per fire before injecting it", () => {
		const now = vi.fn(() => 10);
		const session = createSession({ clock: { now }, rules: [rule({ $rtime: "+1ms" })] });
		session.fire();
		expect(now).toHaveBeenCalledTimes(1);
		expect(session.getPath("result")).toBe(11);
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, "secret"])("rejects invalid clock value without mutation", (value) => {
		const session = createSession({ clock: { now: () => value as number } });
		const error = capture(() => session.fire());
		expect(error.code).toBe("ARBITER_INVALID_CLOCK_OPERATION");
		expect(error.message).toBe("Configured clock returned an invalid time");
		expect(session.getPath("$meta.$now")).toBeUndefined();
	});

	it("does not independently refire an RHS-only temporal dependency on tick", () => {
		let now = 1_000;
		const session = createSession({
			clock: { now: () => now },
			initialState: { enabled: true },
			rules: [{ name: "once", when: { enabled: true }, then: [{ $set: { result: { $rtime: "+1s" } } }] }],
		});
		session.fire();
		expect(session.getPath("result")).toBe(2_000);
		now = 5_000;
		session.tick();
		expect(session.getPath("result")).toBe(2_000);
	});
});

describe("sugar diagnostic limit paths", () => {
	const values = {
		$switch: { $switch: { branches: [{ case: true, then: 1 }] } },
		$rtime: { $rtime: "+1ms" },
		$after: { $after: 0 },
		$before: { $before: 2_000 },
		$elapsed: { $elapsed: [0, 1] },
		$within: { $within: [0, 2_000] },
	} as const;

	it.each(Object.entries(values))("collapses maxNodes scaffolding for %s", (operator, value) => {
		const error = capture(() => createSession({ expressions: { limits: { maxNodes: 1 } }, rules: [rule(value)] }));
		expectLimitPath(error, operator);
	});

	it.each(Object.entries(values))("collapses maxEvaluationSteps scaffolding for %s", (operator, value) => {
		const session = createSession({
			clock: clock(1_000),
			expressions: { limits: { maxEvaluationSteps: 1 } },
			rules: [rule(value)],
		});
		expectLimitPath(
			capture(() => session.fire()),
			operator,
		);
	});

	it.each(Object.entries(values))("collapses maxDepth scaffolding for %s", (operator, value) => {
		const nested = operator === "$rtime" ? { $sum: [value] } : value;
		const error = capture(() => createSession({ expressions: { limits: { maxDepth: 1 } }, rules: [rule(nested)] }));
		expectLimitPath(error, operator);
	});
});

function run(value: unknown, initialState: Record<string, unknown> = {}, now?: number): unknown {
	const session = createSession({
		initialState,
		clock: now === undefined ? undefined : clock(now),
		rules: [rule(value)],
	});
	session.fire();
	return session.getPath("result");
}

function rule(value: unknown): ProductionRule {
	return { name: "sugar", when: {}, then: [{ $set: { result: value } }] };
}

function options() {
	return { bindings: new Set<string>(), namespaces: new Set(["$meta"]), profile: arbitreV1, ruleName: "sugar" };
}

function canonicalOp(op: string): {
	readonly $expression: { readonly kind: "op"; readonly op: string; readonly args: [] };
} {
	return { $expression: { kind: "op", op, args: [] } };
}

function capture(action: () => unknown): ArbiterError {
	try {
		action();
		throw new Error("Expected failure");
	} catch (error) {
		expect(error).toBeInstanceOf(ArbiterError);
		return error as ArbiterError;
	}
}

function expectLimitPath(error: ArbiterError, operator: string): void {
	expect(error.details).toMatchObject({ diagnosticCode: expect.stringMatching(/^EXPRESSION_/) });
	const path = (error.details as { path: readonly (string | number)[] }).path;
	expect(path).toContain(operator);
	expect(path).not.toContain("args");
}
