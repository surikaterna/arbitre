import type { JsonValue, ReferenceResolution } from "kuery/expression";
import type { Token } from "./beta-node.js";
import { ArbiterError, ArbiterErrorCode } from "./errors.js";
import { authoredPath } from "./expression-lower.js";
import type { ArbitreReference, CompiledArbitreValue } from "./expression-types.js";
import type { ScopeManager } from "./scope.js";
import { isRecord } from "./type-guards.js";

export function evaluateArbitreValue(
	value: CompiledArbitreValue,
	scope: ScopeManager,
	ruleName: string,
	token?: Token,
): JsonValue {
	const result = value.expression.evaluate((reference: ArbitreReference) => resolveReference(reference, scope, token));
	if (result.ok) return result.value;
	const path = authoredPath(result.diagnostic.path, value.diagnosticPaths);
	throw new ArbiterError(
		ArbiterErrorCode.EXPRESSION_EVALUATION_FAILED,
		`Rule "${ruleName}" RHS expression failed (${result.diagnostic.code}) at ${path.join(".") || "root"}`,
		{ ruleName, details: { diagnosticCode: result.diagnostic.code, path } },
	);
}

function resolveReference(reference: ArbitreReference, scope: ScopeManager, token?: Token): ReferenceResolution {
	try {
		if (reference.source === "binding") return resolveBinding(reference, token);
		const path = reference.source === "namespace" ? joinPath(reference.namespace, reference.path) : reference.path;
		const value = scope.get(path);
		return value === undefined ? { found: false, reason: "missing" } : { found: true, value: value as JsonValue };
	} catch {
		throw new Error("Reference resolution failed");
	}
}

function resolveBinding(
	reference: Extract<ArbitreReference, { readonly source: "binding" }>,
	token?: Token,
): ReferenceResolution {
	const fact = token?.factBindings[reference.binding];
	if (!fact) return { found: false, reason: "denied" };
	let current: unknown = fact.data;
	for (const segment of reference.path.split(".")) {
		if (!isRecord(current) || !Object.hasOwn(current, segment)) return { found: false, reason: "missing" };
		current = current[segment];
	}
	return current === undefined ? { found: false, reason: "missing" } : { found: true, value: current as JsonValue };
}

function joinPath(parent: string, child: string): string {
	return child ? `${parent}.${child}` : parent;
}
