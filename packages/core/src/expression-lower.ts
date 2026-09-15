import { compileExpression } from "kuery/expression";
import type { ExpressionLimits, ExpressionProfile, JsonValue, ReferenceCodec, ValueExpression } from "kuery/expression";
import type { Result } from "kuery/expression";
import { ArbiterError, ArbiterErrorCode } from "./errors.js";
import { lowerExpressionSugar, mapping } from "./expression-sugar.js";
import type { LoweredExpression } from "./expression-sugar.js";
import type {
	ArbitreReference,
	CanonicalArbitreExpression,
	CompiledArbitreValue,
	DiagnosticPathMapping,
} from "./expression-types.js";
import { splitPath, validatePath } from "./path-utils.js";

const OPERATORS: Readonly<Record<string, string>> = Object.freeze({
	$eq: "eq",
	$ne: "neq",
	$gt: "gt",
	$gte: "gte",
	$lt: "lt",
	$lte: "lte",
	$and: "and",
	$or: "or",
	$not: "not",
	$in: "in",
	$nin: "nin",
	$exists: "exists",
	$ifNull: "coalesce",
	$coalesce: "coalesce",
	$cond: "if",
	$subtract: "sub",
	$divide: "div",
	$min: "arbitre:min",
	$max: "arbitre:max",
	$avg: "arbitre:avg",
	$round: "arbitre:round",
	$ceil: "arbitre:ceil",
	$floor: "arbitre:floor",
	$concat: "arbitre:concat",
});

export interface LowerOptions {
	readonly bindings: ReadonlySet<string>;
	readonly namespaces: ReadonlySet<string>;
	readonly profile: ExpressionProfile;
	readonly ruleName: string;
	readonly limits?: Partial<ExpressionLimits> | undefined;
}

export function compileArbitreValue(input: unknown, options: LowerOptions): CompiledArbitreValue {
	let result: Result<import("kuery/expression").CompiledExpression<ArbitreReference>>;
	let mappings: readonly DiagnosticPathMapping[] = [];
	try {
		const lowered = lower(input, options, []);
		mappings = lowered.mappings;
		result = compileExpression<ArbitreReference>(lowered.node, {
			profile: options.profile,
			reference: createReferenceCodec(options),
			limits: options.limits,
		});
	} catch (error) {
		if (error instanceof ArbiterError) throw error;
		fail("EXPRESSION_INVALID_INPUT", [], options.ruleName);
	}
	if (!result.ok) fail(result.diagnostic.code, authoredPath(result.diagnostic.path, mappings), options.ruleName);
	return Object.freeze({ expression: result.value, diagnosticPaths: mappings });
}

function lower(input: unknown, options: LowerOptions, path: readonly (string | number)[]): LoweredExpression {
	if (isCanonicalWrapper(input)) {
		const node = dataValue(input, "$expression", path, options.ruleName) as ValueExpression<ArbitreReference>;
		return lowered(node, path, "pass-through");
	}
	if (typeof input === "string" && input.startsWith("$")) return lowered(lowerReference(input, options), path);
	if (operatorCandidate(input)) return lowerOperator(input, options, path);
	return lowered({ kind: "literal", value: input as JsonValue }, path);
}

function operatorCandidate(input: unknown): input is Record<string, unknown> {
	if (!plainObject(input)) return false;
	return safeKeys(input).some((key) => key.startsWith("$"));
}

function lowerOperator(
	input: Record<string, unknown>,
	options: LowerOptions,
	path: readonly (string | number)[],
): LoweredExpression {
	const keys = safeKeys(input);
	if (keys.length !== 1 || !keys[0]?.startsWith("$")) fail("ambiguous shorthand", path, options.ruleName);
	const key = keys[0]!;
	const raw = dataValue(input, key, path, options.ruleName);
	if (key === "$literal") return lowered({ kind: "literal", value: raw as JsonValue }, [...path, key]);
	if (REMOVED_OPERATORS.has(key)) fail(`removed operator ${key}`, path, options.ruleName);
	const sugar = lowerExpressionSugar(key, raw, path, {
		lower: (value, authored) => lower(value, options, authored),
		fail: (reason, authored) => fail(reason, authored, options.ruleName),
	});
	if (sugar) return sugar;
	if (key === "$sum" || key === "$multiply") return lowerArithmetic(key, raw, options, path);
	const operator = OPERATORS[key];
	if (!operator) fail(`unknown operator ${key}`, path, options.ruleName);
	let args: readonly unknown[] = Array.isArray(raw) ? arrayValues(raw, [...path, key], options.ruleName) : [raw];
	if (key === "$round" && args.length === 1) args = [args[0], 0];
	const children = args.map((arg, index) => lower(arg, options, [...path, key, index]));
	return combineLowered(operator, children, [...path, key]);
}

const REMOVED_OPERATORS = new Set(["$toNumber", "$toString", "$toBool"]);

function lowerArithmetic(
	key: "$sum" | "$multiply",
	raw: unknown,
	options: LowerOptions,
	path: readonly (string | number)[],
): LoweredExpression {
	const values = Array.isArray(raw) ? arrayValues(raw, [...path, key], options.ruleName) : [raw];
	if (values.length === 0 || values.length > 32) fail(`${key} requires 1 to 32 arguments`, path, options.ruleName);
	const nodes = values.map((value, index) => lower(value, options, [...path, key, index]));
	const operator = key === "$sum" ? "add" : "mul";
	if (nodes.length === 1) {
		const identity = lowered({ kind: "literal", value: operator === "add" ? 0 : 1 }, [...path, key]);
		return combineLowered(operator, [nodes[0]!, identity], [...path, key]);
	}
	return binaryTree(operator, nodes, [...path, key]);
}

function binaryTree(
	operator: "add" | "mul",
	nodes: readonly LoweredExpression[],
	path: readonly (string | number)[],
): LoweredExpression {
	if (nodes.length === 1) return nodes[0]!;
	const middle = Math.ceil(nodes.length / 2);
	return combineLowered(
		operator,
		[binaryTree(operator, nodes.slice(0, middle), path), binaryTree(operator, nodes.slice(middle), path)],
		path,
	);
}

function arrayValues(input: unknown[], path: readonly (string | number)[], ruleName: string): readonly unknown[] {
	try {
		const keys = Reflect.ownKeys(input);
		if (keys.length !== input.length + 1) fail("invalid argument array", path, ruleName);
		return Array.from({ length: input.length }, (_, index) => {
			const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
			if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
				fail("invalid argument array", [...path, index], ruleName);
			}
			return descriptor.value;
		});
	} catch (error) {
		if (error instanceof ArbiterError) throw error;
		fail("invalid argument array", path, ruleName);
	}
}

function lowerReference(input: string, options: LowerOptions): ValueExpression<ArbitreReference> {
	if (input.startsWith("$$")) return lowerNamespaceReference(input.slice(2), options);
	const raw = input.slice(1);
	if (!raw) fail("empty reference", [], options.ruleName);
	const segments = splitPath(raw);
	const first = segments[0]!;
	const path = segments.slice(1).join(".");
	if (options.bindings.has(first)) {
		validateReferencePath(path, options.ruleName);
		return { kind: "ref", ref: { source: "binding", binding: first, path } };
	}
	const namespace = `$${first}`;
	if (options.namespaces.has(namespace)) return namespaceReference(namespace, path, options.ruleName);
	validateReferencePath(raw, options.ruleName);
	return { kind: "ref", ref: { source: "root", path: raw } };
}

function lowerNamespaceReference(raw: string, options: LowerOptions): ValueExpression<ArbitreReference> {
	const segments = splitPath(raw);
	const namespace = `$${segments[0] ?? ""}`;
	const path = segments.slice(1).join(".");
	if (!safePath(raw)) fail("invalid namespace reference", [], options.ruleName);
	if (!options.namespaces.has(namespace)) fail(`unknown namespace ${namespace}`, [], options.ruleName);
	return namespaceReference(namespace, path, options.ruleName);
}

function namespaceReference(namespace: string, path: string, ruleName: string): ValueExpression<ArbitreReference> {
	validateReferencePath(path, ruleName);
	return { kind: "ref", ref: { source: "namespace", namespace, path } };
}

function isCanonicalWrapper(input: unknown): input is CanonicalArbitreExpression {
	return plainObject(input) && safeKeys(input).length === 1 && safeKeys(input)[0] === "$expression";
}

function plainObject(input: unknown): input is Record<string, unknown> {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
	try {
		const prototype = Object.getPrototypeOf(input);
		return prototype === Object.prototype || prototype === null;
	} catch {
		return false;
	}
}

function safeKeys(input: object): string[] {
	try {
		const keys = Reflect.ownKeys(input);
		if (keys.some((key) => typeof key !== "string")) return ["<invalid-key>", ...Object.keys(input)];
		return keys as string[];
	} catch {
		return [];
	}
}

function dataValue(input: object, key: string, path: readonly (string | number)[], ruleName: string): unknown {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(input, key);
		if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError();
		return descriptor.value;
	} catch {
		fail("expression property must be plain data", path, ruleName);
	}
}

function fail(reason: string, path: readonly (string | number)[], ruleName: string): never {
	throw new ArbiterError(
		ArbiterErrorCode.EXPRESSION_COMPILATION_FAILED,
		`Rule "${ruleName}" RHS expression is invalid (${reason}) at ${path.join(".") || "root"}`,
		{ ruleName, details: { diagnosticCode: reason, path } },
	);
}

function createReferenceCodec(options: LowerOptions): ReferenceCodec<ArbitreReference> {
	return { validate: (value: unknown): value is ArbitreReference => validReference(value, options) };
}

function validReference(value: unknown, options: LowerOptions): value is ArbitreReference {
	if (!plainObject(value) || typeof value.source !== "string") return false;
	const keys = safeKeys(value).sort();
	if (value.source === "root") return exactKeys(keys, ["path", "source"]) && safePath(value.path);
	if (value.source === "namespace") {
		return (
			exactKeys(keys, ["namespace", "path", "source"]) &&
			typeof value.namespace === "string" &&
			options.namespaces.has(value.namespace) &&
			safePath(value.path)
		);
	}
	return (
		value.source === "binding" &&
		exactKeys(keys, ["binding", "path", "source"]) &&
		typeof value.binding === "string" &&
		options.bindings.has(value.binding) &&
		safePath(value.path)
	);
}

function exactKeys(actual: readonly string[], expected: readonly string[]): boolean {
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safePath(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0) return false;
	try {
		validatePath(value);
		return true;
	} catch {
		return false;
	}
}

function validateReferencePath(path: string, ruleName: string): void {
	if (!safePath(path)) fail("invalid reference path", [], ruleName);
}

export function authoredPath(
	canonical: readonly (string | number)[],
	mappings: readonly DiagnosticPathMapping[],
): readonly (string | number)[] {
	let nearest: DiagnosticPathMapping | undefined;
	for (const mapping of mappings) {
		if (isPrefix(mapping.canonical, canonical) && (!nearest || mapping.canonical.length > nearest.canonical.length)) {
			nearest = mapping;
		}
	}
	if (!nearest || nearest.behavior === "collapse") return nearest?.authored ?? canonical;
	return [...nearest.authored, ...canonical.slice(nearest.canonical.length)];
}

function isPrefix(prefix: readonly (string | number)[], path: readonly (string | number)[]): boolean {
	return prefix.length <= path.length && prefix.every((part, index) => part === path[index]);
}

function lowered(
	node: ValueExpression<ArbitreReference>,
	authored: readonly (string | number)[],
	behavior: DiagnosticPathMapping["behavior"] = "collapse",
): LoweredExpression {
	return { node, mappings: Object.freeze([mapping([], authored, behavior)]) };
}

function combineLowered(
	operator: string,
	children: readonly LoweredExpression[],
	authored: readonly (string | number)[],
): LoweredExpression {
	const mappings = [mapping([], authored, "collapse")];
	for (let index = 0; index < children.length; index += 1) {
		for (const child of children[index]!.mappings) {
			mappings.push(mapping(["args", index, ...child.canonical], child.authored, child.behavior));
		}
	}
	return {
		node: { kind: "op", op: operator, args: children.map((child) => child.node) },
		mappings: Object.freeze(mappings),
	};
}
