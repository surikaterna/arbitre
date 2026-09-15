import { compile } from "kuery/compile";
import type { ExpressionLimits, ExpressionProfile } from "kuery/expression";
import type { CompiledStage, ThenStage } from "./contracts.js";
import { ArbiterError, ArbiterErrorCode } from "./errors.js";
import { compileArbitreValue } from "./expression-lower.js";
import { arbitreV1 } from "./expression-profile.js";
import { validatePath } from "./path-utils.js";
import { isRecord } from "./type-guards.js";

/**
 * Extracts the single $-prefixed operator key and body from a pipeline stage.
 */
function extractOperator(stage: ThenStage<unknown>): { readonly operator: string; readonly body: unknown } {
	const keys = Object.keys(stage);
	const opKeys = keys.filter((k) => k.startsWith("$"));
	if (opKeys.length !== 1) {
		throw new ArbiterError(
			ArbiterErrorCode.RULE_COMPILATION_FAILED,
			`Then stage must have exactly one $-prefixed operator, got: ${opKeys.join(", ") || "none"}`,
		);
	}
	return { operator: opKeys[0], body: stage[opKeys[0]] };
}

/**
 * Compiles a single ThenStage into a CompiledStage.
 */
interface ThenCompileOptions {
	readonly bindings: ReadonlySet<string>;
	readonly namespaces: ReadonlySet<string>;
	readonly profile: ExpressionProfile;
	readonly ruleName: string;
	readonly limits?: Partial<ExpressionLimits> | undefined;
}

const DEFAULT_OPTIONS: ThenCompileOptions = {
	bindings: new Set(),
	namespaces: new Set(["$meta"]),
	profile: arbitreV1,
	ruleName: "anonymous",
};

function compileStage(stage: ThenStage<unknown>, options: ThenCompileOptions): CompiledStage {
	const { operator, body } = extractOperator(stage);

	if (operator === "$focus") {
		if (!isRecord(body)) {
			throw new ArbiterError(ArbiterErrorCode.RULE_COMPILATION_FAILED, "$focus stage body must be an object");
		}
		const entries = new Map<string, unknown>();
		entries.set("group", body["group"]);
		return { operator, entries };
	}

	if (!isRecord(body)) {
		throw new ArbiterError(ArbiterErrorCode.RULE_COMPILATION_FAILED, `Stage body for "${operator}" must be an object`);
	}
	const entries = new Map<string, unknown>();

	for (const path of ownKeys(body, operator)) {
		const value = ownValue(body, path, operator);
		validatePath(path);
		if (operator === "$pull") {
			if (!isRecord(value)) {
				throw new ArbiterError(ArbiterErrorCode.RULE_COMPILATION_FAILED, "$pull value must be an object");
			}
			entries.set(path, compile(value));
		} else if (["$set", "$inc", "$push", "$merge"].includes(operator)) {
			entries.set(path, compileArbitreValue(value, options));
		} else {
			entries.set(path, value);
		}
	}

	return { operator, entries };
}

function ownKeys(body: object, operator: string): readonly string[] {
	try {
		return Object.keys(body);
	} catch {
		throw new ArbiterError(ArbiterErrorCode.RULE_COMPILATION_FAILED, `Stage body for "${operator}" is invalid`);
	}
}

function ownValue(body: object, key: string, operator: string): unknown {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(body, key);
		if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError();
		return descriptor.value;
	} catch {
		throw new ArbiterError(
			ArbiterErrorCode.RULE_COMPILATION_FAILED,
			`Stage body for "${operator}" requires data properties`,
		);
	}
}

/**
 * Compiles an array of ThenStage into CompiledStage[].
 */
export function compileThenActions(
	stages: readonly ThenStage<unknown>[],
	options: ThenCompileOptions = DEFAULT_OPTIONS,
): readonly CompiledStage[] {
	return stages.map((stage) => compileStage(stage, options));
}
