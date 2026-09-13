import type { ExpressionLimits, ExpressionProfile } from "kuery/expression";
import type { CompiledRule, ProductionRule } from "./contracts.js";
import { extractActionDeps, extractConditionDeps, extractRhsDeps } from "./dependency-extract.js";
import { ArbiterError, ArbiterErrorCode } from "./errors.js";
import { arbitreV1 } from "./expression-profile.js";
import { compileRuleComponents, freezeRuleDependencies } from "./rule-components.js";
import { isRecord } from "./type-guards.js";
import { validateRule } from "./validate-rule.js";

/**
 * Compiles a ProductionRule into a CompiledRule ready for the engine.
 */
export interface RuleCompileOptions {
	readonly customFnNames?: ReadonlySet<string> | undefined;
	readonly namespaces: ReadonlySet<string>;
	readonly profile: ExpressionProfile;
	readonly limits?: Partial<ExpressionLimits> | undefined;
}

const DEFAULT_OPTIONS: RuleCompileOptions = { namespaces: new Set(["$meta"]), profile: arbitreV1 };

export function compileRule(
	rule: ProductionRule<unknown>,
	options: RuleCompileOptions = DEFAULT_OPTIONS,
): CompiledRule {
	validateRule(rule);
	assertRuleShape(rule);
	const components = compileRuleComponents(rule, options);
	const { condition, actions, elseActions, hasPatterns, patterns, accumulates } = components;
	const allActions = elseActions ? [...actions, ...elseActions] : actions;
	const rhsReads = extractRhsDeps(allActions);
	const dependencies = freezeRuleDependencies(extractConditionDeps(condition), rhsReads, extractActionDeps(allActions));
	return {
		name: rule.name,
		condition,
		actions,
		elseActions,
		salience: rule.salience ?? 0,
		activationGroup: rule.activationGroup,
		onConflict: rule.onConflict ?? "warn",
		enabled: rule.enabled ?? true,
		hasTms: rule.else === undefined,
		hasPatterns,
		patterns,
		accumulates,
		source: rule,
		dependencies,
	};
}

function assertRuleShape(rule: ProductionRule<unknown>): void {
	if (!rule.name) throw new ArbiterError(ArbiterErrorCode.RULE_COMPILATION_FAILED, "Rule must have a name");
	if (!rule.when || !isRecord(rule.when)) {
		throw new ArbiterError(
			ArbiterErrorCode.RULE_COMPILATION_FAILED,
			`Rule "${rule.name}" must have a "when" condition`,
		);
	}
	if (!rule.then?.length) {
		throw new ArbiterError(ArbiterErrorCode.RULE_COMPILATION_FAILED, `Rule "${rule.name}" must have a "then" action`);
	}
}
