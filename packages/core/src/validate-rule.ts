import type { ProductionRule, ThenStage } from "./contracts.js";
import { ArbiterError, ArbiterErrorCode } from "./errors.js";
import { validatePath } from "./path-utils.js";
import { isRecord } from "./type-guards.js";
import { validatePatterns } from "./validate-patterns.js";

export type ValidationLevel = "strict" | "syntax" | "none";

const QUERY_OPERATORS = new Set([
	"$gt",
	"$gte",
	"$lt",
	"$lte",
	"$eq",
	"$ne",
	"$in",
	"$nin",
	"$exists",
	"$regex",
	"$not",
	"$type",
	"$mod",
	"$all",
	"$elemMatch",
	"$size",
]);

const LOGICAL_OPERATORS = new Set(["$and", "$or", "$nor"]);

/**
 * Validate a rule before compilation. Throws ArbiterError on validation failure.
 */
export function validateRule(rule: ProductionRule, level: ValidationLevel = "strict"): void {
	if (level === "none") return;

	validateSyntax(rule);

	if (level === "strict") {
		validateStrict(rule);
	}
}

function validateSyntax(rule: ProductionRule): void {
	if (!rule.name || typeof rule.name !== "string") {
		throw new ArbiterError(ArbiterErrorCode.RULE_COMPILATION_FAILED, "Rule must have a non-empty name");
	}

	if (!rule.when || typeof rule.when !== "object") {
		throw new ArbiterError(ArbiterErrorCode.RULE_COMPILATION_FAILED, `Rule "${rule.name}" must have a "when" clause`, {
			ruleName: rule.name,
		});
	}

	if (!rule.then || rule.then.length === 0) {
		throw new ArbiterError(
			ArbiterErrorCode.RULE_COMPILATION_FAILED,
			`Rule "${rule.name}" must have at least one "then" action`,
			{ ruleName: rule.name },
		);
	}

	validateStagePaths(rule.then, rule.name, "then");
}

function validateStrict(rule: ProductionRule): void {
	walkWhenClause(rule.when, rule.name);
	validateStagePaths(rule.then, rule.name, "then");

	if (rule.else) {
		validateStagePaths(rule.else, rule.name, "else");
	}

	if (rule.patterns && rule.patterns.length > 0) {
		validatePatterns(rule.patterns, rule.name);
	}

	if (rule.salience !== undefined && !Number.isFinite(rule.salience)) {
		throw new ArbiterError(
			ArbiterErrorCode.RULE_COMPILATION_FAILED,
			`Rule "${rule.name}" has non-finite salience: ${rule.salience}`,
			{ ruleName: rule.name },
		);
	}

	if (rule.activationGroup !== undefined) {
		if (typeof rule.activationGroup !== "string" || rule.activationGroup.length === 0) {
			throw new ArbiterError(
				ArbiterErrorCode.RULE_COMPILATION_FAILED,
				`Rule "${rule.name}" has invalid activationGroup`,
				{ ruleName: rule.name },
			);
		}
	}

	if (rule.onConflict !== undefined) {
		const valid = new Set(["override", "warn", "error"]);
		if (!valid.has(rule.onConflict)) {
			throw new ArbiterError(
				ArbiterErrorCode.RULE_COMPILATION_FAILED,
				`Rule "${rule.name}" has invalid onConflict: ${String(rule.onConflict)}`,
				{ ruleName: rule.name },
			);
		}
	}
}

/**
 * Validates that each stage is a single-key $-prefixed object with safe paths.
 */
function validateStagePaths(stages: readonly ThenStage[], ruleName: string, clause: string): void {
	for (const stage of stages) {
		if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
			throw new ArbiterError(
				ArbiterErrorCode.RULE_COMPILATION_FAILED,
				`Rule "${ruleName}" ${clause} stage must be an object`,
				{ ruleName },
			);
		}

		const keys = Object.keys(stage);
		const opKeys = keys.filter((k) => k.startsWith("$"));
		if (opKeys.length !== 1) {
			throw new ArbiterError(
				ArbiterErrorCode.RULE_COMPILATION_FAILED,
				`Rule "${ruleName}" ${clause} stage must have exactly one $-prefixed operator, got: ${opKeys.join(", ") || "none"}`,
				{ ruleName },
			);
		}

		const operator = opKeys[0];
		if (operator === "$focus") continue;

		const body = stage[operator];
		if (!isRecord(body)) continue;

		for (const path of Object.keys(body)) {
			try {
				validatePath(path);
			} catch (err) {
				throw new ArbiterError(
					ArbiterErrorCode.PROTOTYPE_POLLUTION,
					`Rule "${ruleName}" ${clause} stage has dangerous path: "${path}"`,
					err instanceof Error ? { ruleName, cause: err } : { ruleName },
				);
			}
		}
	}
}

function walkWhenClause(obj: Record<string, unknown>, ruleName: string): void {
	for (const key of Object.keys(obj)) {
		if (LOGICAL_OPERATORS.has(key)) {
			const arr = obj[key];
			if (Array.isArray(arr)) {
				for (const item of arr) {
					if (isRecord(item)) {
						walkWhenClause(item, ruleName);
					}
				}
			}
			continue;
		}

		if (QUERY_OPERATORS.has(key)) {
			continue;
		}

		if (!key.startsWith("$")) {
			try {
				validatePath(key);
			} catch (err) {
				throw new ArbiterError(
					ArbiterErrorCode.PROTOTYPE_POLLUTION,
					`Rule "${ruleName}" when clause has dangerous path: "${key}"`,
					err instanceof Error ? { ruleName, cause: err } : { ruleName },
				);
			}
		}

		const val = obj[key];
		if (isRecord(val)) {
			walkWhenClause(val, ruleName);
		}
	}
}
