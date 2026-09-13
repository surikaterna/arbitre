import type { CompiledStage } from "./contracts.js";
import type { ArbitreReference, CompiledArbitreValue } from "./expression-types.js";
import { isRecord } from "./type-guards.js";

interface PathNode {
	readonly kind: "path";
	readonly path: string;
}

interface OpNode {
	readonly kind: "op";
	readonly op: string;
	readonly args: readonly unknown[];
}

interface LiteralNode {
	readonly kind: "literal";
	readonly value: unknown;
}

type ExprLike = PathNode | OpNode | LiteralNode;

function isExprLike(node: unknown): node is ExprLike {
	if (!isRecord(node)) return false;
	return typeof node.kind === "string";
}

/**
 * Recursively walks an ExprNode tree and collects all field path references.
 */
function collectPaths(node: unknown, out: Set<string>): void {
	if (!isExprLike(node)) return;

	if (node.kind === "path") {
		out.add(node.path);
		return;
	}

	if (node.kind === "op") {
		for (const arg of node.args) {
			collectPaths(arg, out);
		}
	}
}

/**
 * Extract all field paths referenced in a compiled condition (ExprNode).
 */
export function extractConditionDeps(condition: unknown): readonly string[] {
	const paths = new Set<string>();
	collectPaths(condition, paths);
	return [...paths];
}

/**
 * Extract all field paths that a rule's stages write to.
 */
export function extractActionDeps(stages: readonly CompiledStage[]): readonly string[] {
	const paths = new Set<string>();
	for (const stage of stages) {
		if (stage.operator === "$focus") continue;
		for (const path of stage.entries.keys()) {
			paths.add(path);
		}
	}
	return [...paths];
}

export function extractRhsDeps(stages: readonly CompiledStage[]): readonly ArbitreReference[] {
	const dependencies: ArbitreReference[] = [];
	const seen = new Set<string>();
	for (const stage of stages) {
		if (!["$set", "$inc", "$push", "$merge"].includes(stage.operator)) continue;
		for (const value of stage.entries.values()) collectRhsValue(value, dependencies, seen);
	}
	return Object.freeze(dependencies);
}

function collectRhsValue(value: unknown, output: ArbitreReference[], seen: Set<string>): void {
	if (!isCompiledValue(value)) return;
	for (const reference of value.expression.dependencies) {
		const identity = JSON.stringify(reference);
		if (seen.has(identity)) continue;
		seen.add(identity);
		output.push(reference);
	}
}

function isCompiledValue(value: unknown): value is CompiledArbitreValue {
	return isRecord(value) && isRecord(value.expression) && Array.isArray(value.expression.dependencies);
}
