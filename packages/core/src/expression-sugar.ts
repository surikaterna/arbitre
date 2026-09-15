import type { ValueExpression } from "kuery/expression";
import type { ArbitreReference, DiagnosticPathMapping } from "./expression-types.js";

export type ExpressionPath = readonly (string | number)[];
type Node = ValueExpression<ArbitreReference>;

export interface LoweredExpression {
	readonly node: Node;
	readonly mappings: readonly DiagnosticPathMapping[];
}

export interface SugarLowering {
	readonly lower: (value: unknown, authoredPath: ExpressionPath) => LoweredExpression;
	readonly fail: (reason: string, path: ExpressionPath) => never;
}

const DURATION = /^([+-])(0|[1-9][0-9]*)(ms|s|m|h|d)$/;
const MULTIPLIERS: Readonly<Record<string, bigint>> = Object.freeze({
	ms: 1n,
	s: 1_000n,
	m: 60_000n,
	h: 3_600_000n,
	d: 86_400_000n,
});
const MAX_SAFE_DELTA = BigInt(Number.MAX_SAFE_INTEGER);

export function lowerExpressionSugar(
	key: string,
	raw: unknown,
	path: ExpressionPath,
	context: SugarLowering,
): LoweredExpression | undefined {
	if (key === "$switch") return lowerSwitch(raw, [...path, key], context);
	if (key === "$rtime") return lowerRelativeTime(raw, [...path, key], context);
	if (key === "$after" || key === "$before") return lowerComparison(key, raw, [...path, key], context);
	if (key === "$elapsed" || key === "$within") return lowerWindow(key, raw, [...path, key], context);
	return undefined;
}

function lowerSwitch(raw: unknown, authored: ExpressionPath, context: SugarLowering): LoweredExpression {
	const properties = exactDataObject(raw, ["branches"], ["default"], authored, "$switch descriptor", context);
	const branches = denseArray(properties.get("branches"), authored, 1, 32, "$switch branches", context);
	const parsed = branches.map((branch, index) => {
		const branchPath = [...authored, "branches", index];
		return exactDataObject(branch, ["case", "then"], [], branchPath, "$switch branch", context);
	});
	let result = properties.has("default")
		? context.lower(properties.get("default"), [...authored, "default"])
		: generated(literal(null), authored);
	for (let index = parsed.length - 1; index >= 0; index -= 1) {
		result = prependSwitchBranch(parsed[index]!, index, result, authored, context);
	}
	return result;
}

function prependSwitchBranch(
	branch: ReadonlyMap<string, unknown>,
	index: number,
	otherwise: LoweredExpression,
	authored: ExpressionPath,
	context: SugarLowering,
): LoweredExpression {
	const branchPath = [...authored, "branches", index];
	const condition = context.lower(branch.get("case"), [...branchPath, "case"]);
	const selected = context.lower(branch.get("then"), [...branchPath, "then"]);
	return combine(op("if", [condition.node, selected.node, otherwise.node]), authored, [
		[condition, ["args", 0]],
		[selected, ["args", 1]],
		[otherwise, ["args", 2]],
	]);
}

function lowerRelativeTime(raw: unknown, authored: ExpressionPath, context: SugarLowering): LoweredExpression {
	if (typeof raw !== "string") context.fail("$rtime requires a signed duration string", authored);
	const match = DURATION.exec(raw);
	if (!match) context.fail("$rtime requires a signed fixed-unit duration", authored);
	const magnitude = BigInt(match[2]!) * MULTIPLIERS[match[3]!]!;
	if (magnitude > MAX_SAFE_DELTA) context.fail("$rtime duration exceeds the safe integer range", authored);
	const delta = Number(match[1] === "-" ? -magnitude : magnitude);
	return generated(op("add", [clock(), literal(delta)]), authored);
}

function lowerComparison(
	key: "$after" | "$before",
	raw: unknown,
	authored: ExpressionPath,
	context: SugarLowering,
): LoweredExpression {
	const tuple = Array.isArray(raw);
	const operandValue = tuple ? denseArray(raw, authored, 1, 1, `${key} tuple`, context)[0] : raw;
	const operand = context.lower(operandValue, tuple ? [...authored, 0] : authored);
	const numericOperand = op("add", [operand.node, literal(0)]);
	const comparison = op(key === "$after" ? "gt" : "lt", [clock(), numericOperand]);
	const root = temporalGuard(comparison, [clock(), numericOperand]);
	return combine(root, authored, [
		[operand, ["args", 0, "args", 1, "args", 0, "args", 0]],
		[operand, ["args", 1, "args", 1, "args", 0]],
	]);
}

function lowerWindow(
	key: "$elapsed" | "$within",
	raw: unknown,
	authored: ExpressionPath,
	context: SugarLowering,
): LoweredExpression {
	const values = denseArray(raw, authored, 2, 2, `${key} tuple`, context);
	const start = context.lower(values[0], [...authored, 0]);
	const duration = context.lower(values[1], [...authored, 1]);
	const elapsed = op("sub", [clock(), start.node]);
	const numericDuration = op("add", [duration.node, literal(0)]);
	const comparison = op(key === "$elapsed" ? "gt" : "lt", [elapsed, numericDuration]);
	const root = temporalGuard(comparison, [clock(), start.node, duration.node]);
	return combine(root, authored, temporalMappings(start, duration));
}

function temporalMappings(
	start: LoweredExpression,
	duration: LoweredExpression,
): readonly [LoweredExpression, ExpressionPath][] {
	return [
		[start, ["args", 0, "args", 1, "args", 0]],
		[duration, ["args", 0, "args", 2, "args", 0]],
		[start, ["args", 1, "args", 0, "args", 1]],
		[duration, ["args", 1, "args", 1, "args", 0]],
	];
}

function temporalGuard(comparison: Node, operands: readonly Node[]): Node {
	return op("if", [
		op(
			"and",
			operands.map((operand) => op("exists", [operand])),
		),
		comparison,
		literal(false),
	]);
}

function combine(
	node: Node,
	authored: ExpressionPath,
	children: readonly (readonly [LoweredExpression, ExpressionPath])[],
): LoweredExpression {
	return {
		node,
		mappings: Object.freeze([
			mapping([], authored, "collapse"),
			...children.flatMap(([child, prefix]) => prefixMappings(child.mappings, prefix)),
		]),
	};
}

function generated(node: Node, authored: ExpressionPath): LoweredExpression {
	return { node, mappings: Object.freeze([mapping([], authored, "collapse")]) };
}

function prefixMappings(
	mappings: readonly DiagnosticPathMapping[],
	prefix: ExpressionPath,
): readonly DiagnosticPathMapping[] {
	return mappings.map((entry) => mapping([...prefix, ...entry.canonical], entry.authored, entry.behavior));
}

export function mapping(
	canonical: ExpressionPath,
	authored: ExpressionPath,
	behavior: DiagnosticPathMapping["behavior"],
): DiagnosticPathMapping {
	return Object.freeze({ canonical: Object.freeze([...canonical]), authored: Object.freeze([...authored]), behavior });
}

function exactDataObject(
	input: unknown,
	required: readonly string[],
	optional: readonly string[],
	path: ExpressionPath,
	label: string,
	context: SugarLowering,
): ReadonlyMap<string, unknown> {
	if (!plainObject(input)) context.fail(`${label} must be an exact plain data object`, path);
	const entries = dataEntries(input, path, label, context);
	const keys = [...entries.keys()];
	if (
		required.some((key) => !entries.has(key)) ||
		keys.some((key) => !required.includes(key) && !optional.includes(key))
	) {
		context.fail(`${label} has invalid properties`, path);
	}
	return entries;
}

function dataEntries(input: object, path: ExpressionPath, label: string, context: SugarLowering): Map<string, unknown> {
	const output = new Map<string, unknown>();
	try {
		for (const key of Reflect.ownKeys(input)) {
			if (typeof key !== "string") context.fail(`${label} has invalid properties`, path);
			const descriptor = Object.getOwnPropertyDescriptor(input, key);
			if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
				context.fail(`${label} requires enumerable data properties`, [...path, key]);
			}
			output.set(key, descriptor.value);
		}
	} catch (error) {
		if (isFailure(error)) throw error;
		context.fail(`${label} is not inspectable`, path);
	}
	return output;
}

function denseArray(
	input: unknown,
	path: ExpressionPath,
	minimum: number,
	maximum: number,
	label: string,
	context: SugarLowering,
): readonly unknown[] {
	if (!Array.isArray(input)) context.fail(`${label} requires an array`, path);
	const length = arrayLength(input, path, label, context);
	if (length < minimum || length > maximum) {
		context.fail(`${label} requires ${minimum === maximum ? minimum : `${minimum} to ${maximum}`} item(s)`, path);
	}
	try {
		if (Reflect.ownKeys(input).length !== length + 1) context.fail(`${label} must be dense data`, path);
		return Array.from({ length }, (_, index) => arrayData(input, index, path, label, context));
	} catch (error) {
		if (isFailure(error)) throw error;
		context.fail(`${label} is not inspectable`, path);
	}
}

function arrayLength(input: unknown[], path: ExpressionPath, label: string, context: SugarLowering): number {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(input, "length");
		if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "number") throw new TypeError();
		return descriptor.value;
	} catch {
		context.fail(`${label} is not inspectable`, path);
	}
}

function arrayData(
	input: unknown[],
	index: number,
	path: ExpressionPath,
	label: string,
	context: SugarLowering,
): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
	if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
		context.fail(`${label} must be dense data`, [...path, index]);
	}
	return descriptor.value;
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

function isFailure(error: unknown): boolean {
	return error instanceof Error && error.name === "ArbiterError";
}

function op(name: string, args: readonly Node[]): Node {
	return { kind: "op", op: name, args };
}

function literal(value: null | number | boolean): Node {
	return { kind: "literal", value };
}

function clock(): Node {
	return { kind: "ref", ref: { source: "namespace", namespace: "$meta", path: "$now" } };
}
