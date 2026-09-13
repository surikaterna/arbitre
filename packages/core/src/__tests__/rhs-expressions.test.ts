import { describe, expect, it } from "vitest";
import type { ProductionRule } from "../contracts.js";
import { ArbiterError } from "../errors.js";
import { compileArbitreValue } from "../expression-lower.js";
import { arbitreV1 } from "../expression-profile.js";
import { expression, literal } from "../expression-types.js";
import { createSession } from "../session.js";

function run(value: unknown, initialState: Record<string, unknown> = {}): unknown {
	const session = createSession({
		initialState,
		rules: [{ name: "rhs", when: {}, then: [{ $set: { result: value } }] }],
	});
	session.fire();
	return session.getPath("result");
}

describe("arbitre-v1 RHS shorthand", () => {
	it.each([
		[{ $sum: [1, 2, 3] }, 6],
		[{ $multiply: [2, 3, 4] }, 24],
		[{ $subtract: [8, 3] }, 5],
		[{ $divide: [8, 2] }, 4],
		[{ $min: [4, 2, 9] }, 2],
		[{ $max: [4, 2, 9] }, 9],
		[{ $avg: [2, 4, 6] }, 4],
		[{ $round: [3.456, 2] }, 3.46],
		[{ $round: 3.6 }, 4],
		[{ $ceil: 3.2 }, 4],
		[{ $floor: 3.8 }, 3],
		[{ $concat: ["a", "b"] }, "ab"],
		[{ $eq: [1, 1] }, true],
		[{ $ne: [1, 2] }, true],
		[{ $gt: [2, 1] }, true],
		[{ $gte: [2, 2] }, true],
		[{ $lt: [1, 2] }, true],
		[{ $lte: [2, 2] }, true],
		[{ $and: [true, true] }, true],
		[{ $or: [false, true] }, true],
		[{ $not: false }, true],
		[{ $in: [2, [1, 2]] }, true],
		[{ $nin: [3, [1, 2]] }, true],
		[{ $ifNull: [null, 7] }, 7],
	])("evaluates %j", (input, expected) => expect(run(input)).toEqual(expected));

	it("lowers nested expressions and references", () => {
		expect(run({ $sum: [{ $multiply: ["$price", 2] }, 1] }, { price: 5 })).toBe(11);
	});

	it("keeps literal expression-shaped data explicit", () => {
		expect(run({ $literal: { $sum: [1, 2] } })).toEqual({ $sum: [1, 2] });
		expect(run(literal({ $sum: [1, 2] }))).toEqual({ $sum: [1, 2] });
	});

	it("accepts the explicit canonical wrapper", () => {
		expect(
			run(
				expression({
					kind: "op",
					op: "add",
					args: [
						{ kind: "literal", value: 2 },
						{ kind: "literal", value: 3 },
					],
				}),
			),
		).toBe(5);
	});

	it("returns independent immutable compiled programs", () => {
		const first = compileArbitreValue({ $sum: [1, 2] }, options());
		const second = compileArbitreValue({ $sum: [1, 2] }, options());
		expect(first.expression).not.toBe(second.expression);
		expect(Object.isFrozen(first.expression)).toBe(true);
	});

	it("lowers variadic arithmetic to deterministic standard binary trees", () => {
		const sum = compileArbitreValue({ $sum: ["$a", "$b", "$c"] }, options()).expression;
		const multiply = compileArbitreValue({ $multiply: [2, 3, 4, 5] }, options()).expression;
		expect(sum.expression).toMatchObject({ kind: "op", op: "add", args: [{ op: "add" }, { kind: "ref" }] });
		expect(sum.dependencies).toEqual([
			{ source: "root", path: "a" },
			{ source: "root", path: "b" },
			{ source: "root", path: "c" },
		]);
		expect(multiply.expression).toMatchObject({ kind: "op", op: "mul", args: [{ op: "mul" }, { op: "mul" }] });
		expect(arbitreV1.has("arbitre:sum")).toBe(false);
		expect(arbitreV1.has("arbitre:multiply")).toBe(false);
	});

	it("defines one-argument arithmetic and rejects empty or oversized shorthand", () => {
		expect(run({ $sum: [7] })).toBe(7);
		expect(run({ $multiply: [7] })).toBe(7);
		for (const value of [{ $sum: [] }, { $multiply: Array(33).fill(1) }]) {
			expect(() => createSession({ rules: [rule(value)] })).toThrow("requires 1 to 32 arguments");
		}
	});

	it.each(["$sum", "$multiply"])("validates unary %s through standard numeric semantics", (operator) => {
		expect(run({ [operator]: ["$value"] }, { value: 7 })).toBe(7);
		for (const value of ["text", { $literal: "text" }]) {
			const error = captureError(() => run({ [operator]: [value] }));
			expect(error.details).toMatchObject({ diagnosticCode: "EXPRESSION_TYPE_MISMATCH" });
		}
		const referenceError = captureError(() => run({ [operator]: ["$value"] }, { value: "text" }));
		expect(referenceError.details).toMatchObject({ diagnosticCode: "EXPRESSION_TYPE_MISMATCH" });
		const literalError = captureError(() =>
			createSession({ rules: [rule({ [operator]: [{ $literal: Number.POSITIVE_INFINITY }] })] }),
		);
		expect(literalError.code).toBe("ARBITER_EXPRESSION_COMPILATION_FAILED");
		expect(literalError.details).toMatchObject({ diagnosticCode: "EXPRESSION_INVALID_INPUT" });
		const referenceFiniteError = captureError(() =>
			run({ [operator]: ["$value"] }, { value: Number.NEGATIVE_INFINITY }),
		);
		expect(referenceFiniteError.code).toBe("ARBITER_EXPRESSION_EVALUATION_FAILED");
		expect(referenceFiniteError.details).toMatchObject({ diagnosticCode: "EXPRESSION_INVALID_RESULT" });
	});

	it("preserves lazy conditional and missing-aware operators", () => {
		expect(run({ $cond: [true, "selected", "$missing"] })).toBe("selected");
		expect(run({ $cond: [false, "$missing", { $literal: { selected: true } }] })).toEqual({ selected: true });
		expect(run({ $ifNull: ["$missing", 7] })).toBe(7);
		expect(run({ $exists: "$missing" })).toBe(false);
	});
});

describe("registration and evaluation diagnostics", () => {
	it.each(["$switch", "$toNumber", "$toString", "$toBool", "$elapsed", "$within", "$after", "$before"])(
		"rejects removed %s",
		(operator) => {
			expectErrorCode(
				() => createSession({ rules: [rule({ [operator]: [1] })] }),
				"ARBITER_EXPRESSION_COMPILATION_FAILED",
			);
		},
	);

	it.each(["$elapsed", "$within", "$after", "$before"])("reports temporal migration for %s", (operator) => {
		const error = captureError(() => createSession({ rules: [rule({ [operator]: [1, 2] })] }));
		expect(error.details).toMatchObject({ diagnosticCode: `removed operator ${operator}`, path: [] });
	});

	it("rejects unknown and ambiguous shorthand at registration", () => {
		expect(() => createSession({ rules: [rule({ $wat: 1 })] })).toThrow("unknown operator");
		expect(() => createSession({ rules: [rule({ $sum: [1, 2], extra: true })] })).toThrow("ambiguous shorthand");
	});

	it("rejects accessors, cycles, callbacks, and non-finite literals", () => {
		const accessor = Object.defineProperty({}, "$literal", { enumerable: true, get: () => 1 });
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		for (const value of [accessor, { $literal: cycle }, { $literal: () => 1 }, Number.POSITIVE_INFINITY]) {
			expectErrorCode(() => createSession({ rules: [rule(value)] }), "ARBITER_EXPRESSION_COMPILATION_FAILED");
		}
	});

	it("rejects accessors before reading stage entries", () => {
		let reads = 0;
		const body = Object.defineProperty({}, "result", {
			enumerable: true,
			get: () => {
				reads++;
				return 1;
			},
		});
		expect(() => createSession({ rules: [{ name: "accessor", when: {}, then: [{ $set: body }] }] })).toThrow(
			"requires data properties",
		);
		expect(reads).toBe(0);
	});

	it("rejects sparse and accessor shorthand arguments without invoking getters", () => {
		let reads = 0;
		const accessor: unknown[] = [];
		Object.defineProperty(accessor, "0", {
			enumerable: true,
			get: () => {
				reads++;
				return 1;
			},
		});
		accessor.length = 1;
		const sparse = Array(2);
		for (const args of [accessor, sparse]) {
			expectErrorCode(() => createSession({ rules: [rule({ $sum: args })] }), "ARBITER_EXPRESSION_COMPILATION_FAILED");
		}
		expect(reads).toBe(0);
	});

	it("rejects dangerous, malformed, undeclared, and open canonical references", () => {
		const invalid = [
			{ source: "root", path: "__proto__.x" },
			{ source: "root", path: "a..b" },
			{ source: "root", path: "" },
			{ source: "root", path: "safe", extra: true },
			{ source: "namespace", namespace: "$secret", path: "x" },
			{ source: "binding", binding: "secret", path: "x" },
			{ source: "root", path: "prototype.x" },
			{ source: "root", path: "constructor.x" },
		];
		for (const ref of invalid) {
			expectErrorCode(
				() => createSession({ rules: [rule({ $expression: { kind: "ref", ref } })] }),
				"ARBITER_EXPRESSION_COMPILATION_FAILED",
			);
		}
	});

	it("rejects dangerous and unknown shorthand references at registration", () => {
		for (const reference of [
			"$__proto__.x",
			"$prototype.x",
			"$constructor.x",
			"$a..b",
			"$$unknown.x",
			"$$unknown.__proto__.x",
			"$$meta.",
		]) {
			expectErrorCode(() => createSession({ rules: [rule(reference)] }), "ARBITER_EXPRESSION_COMPILATION_FAILED");
		}
	});

	it("validates canonical references without invoking extra getters", () => {
		let reads = 0;
		const ref = Object.defineProperty({ source: "root", path: "safe" }, "extra", {
			enumerable: true,
			get: () => {
				reads++;
				return true;
			},
		});
		expect(() => createSession({ rules: [rule({ $expression: { kind: "ref", ref } })] })).toThrow();
		expect(reads).toBe(0);
	});

	it("maps strict arithmetic and missing failures without leaking values", () => {
		const error = captureError(() => run({ $divide: [1, 0] }));
		expect(error.code).toBe("ARBITER_EXPRESSION_EVALUATION_FAILED");
		expect(error.details).toEqual({ diagnosticCode: "EXPRESSION_DIVISION_BY_ZERO", path: [] });
		expect(() => run("$missing")).toThrow("EXPRESSION_REFERENCE_MISSING");
	});

	it("reports denied binding access distinctly", () => {
		const compiled = compileArbitreValue(
			expression({ kind: "ref", ref: { source: "binding", binding: "x", path: "v" } }),
			{ ...options(), bindings: new Set(["x"]) },
		);
		expect(compiled.expression.evaluate(() => ({ found: false, reason: "denied" }))).toMatchObject({
			ok: false,
			diagnostic: { code: "EXPRESSION_REFERENCE_DENIED" },
		});
	});

	it("contains throwing and invalid pure extension outcomes", () => {
		for (const execute of [
			() => {
				throw new Error("secret payload");
			},
			() => undefined as never,
		]) {
			const session = createSession({
				expressions: { extensions: [{ name: "app:invalid", arity: 0, execute }] },
				rules: [
					{
						name: "extension",
						when: {},
						then: [{ $set: { result: { $expression: { kind: "op", op: "app:invalid", args: [] } } } }],
					},
				],
			});
			const error = captureError(() => session.fire());
			expect(error.message).not.toContain("secret payload");
			expect(error.details).toMatchObject({ diagnosticCode: expect.stringMatching(/^EXPRESSION_/) });
		}
	});

	it("rejects unnamespaced or duplicate profile extensions", () => {
		for (const name of ["plain", "arbitre:min"]) {
			expect(() => createSession({ expressions: { extensions: [{ name, arity: 0, execute: () => 1 }] } })).toThrow(
				"Invalid Arbitre expression profile extension",
			);
		}
	});

	it("supports caller-selected stricter expression bounds", () => {
		expect(() =>
			createSession({
				expressions: { limits: { maxNodes: 2 } },
				rules: [rule({ $sum: [1, 2] })],
			}),
		).toThrow("EXPRESSION_LIMIT_EXCEEDED");
	});
});

function rule(value: unknown): ProductionRule {
	return { name: "invalid", when: {}, then: [{ $set: { result: value } }] };
}

function options() {
	return { bindings: new Set<string>(), namespaces: new Set(["$meta"]), profile: arbitreV1, ruleName: "test" };
}

function expectErrorCode(action: () => unknown, code: string): void {
	expect(captureError(action).code).toBe(code);
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
