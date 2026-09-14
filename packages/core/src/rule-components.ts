import type { ExprNode } from "kuery";
import { compile } from "kuery/compile";
import type { CompiledPattern, CompiledStage, ProductionRule } from "./contracts.js";
import type { ArbitreReference, RuleDependencies } from "./expression-types.js";
import type { RuleCompileOptions } from "./rule-compiler.js";
import { compileThenActions } from "./then-compiler.js";
import { validateAccumulateConfigs } from "./validate-accumulate.js";
import { validatePatterns } from "./validate-patterns.js";

export interface CompiledRuleComponents {
	readonly condition: ExprNode;
	readonly actions: readonly CompiledStage[];
	readonly elseActions?: readonly CompiledStage[] | undefined;
	readonly hasPatterns: boolean;
	readonly patterns?: readonly CompiledPattern[] | undefined;
	readonly accumulates?: ProductionRule<unknown>["accumulate"];
}

export function compileRuleComponents(
	rule: ProductionRule<unknown>,
	options: RuleCompileOptions,
): CompiledRuleComponents {
	const condition = compile(rule.when);
	const thenOptions = {
		bindings: new Set(rule.patterns?.map(({ $bind }) => $bind).filter((name): name is string => !!name) ?? []),
		namespaces: options.namespaces,
		profile: options.profile,
		ruleName: rule.name,
		limits: options.limits,
	};
	const actions = compileThenActions(rule.then, thenOptions);
	const elseActions = rule.else ? compileThenActions(rule.else, thenOptions) : undefined;
	const patterns = compilePatterns(rule);
	const accumulates = compileAccumulates(rule, options.customFnNames);
	return { condition, actions, elseActions, hasPatterns: patterns !== undefined, patterns, accumulates };
}

function compilePatterns(rule: ProductionRule<unknown>): readonly CompiledPattern[] | undefined {
	if (!rule.patterns?.length) return undefined;
	validatePatterns(rule.patterns, rule.name);
	return rule.patterns.map((pattern) => ({
		$fact: pattern.$fact,
		$bind: pattern.$bind,
		$where: pattern.$where,
		$join: pattern.$join,
	}));
}

function compileAccumulates(rule: ProductionRule<unknown>, customNames?: ReadonlySet<string>) {
	if (!rule.accumulate?.length) return undefined;
	validateAccumulateConfigs(rule.accumulate, rule.name, customNames);
	return rule.accumulate;
}

export function freezeRuleDependencies(
	conditionReads: readonly string[],
	rhsReads: readonly ArbitreReference[],
	actionWrites: readonly string[],
	actionWritesUnknown = false,
): RuleDependencies {
	const references = Object.freeze(rhsReads.map(freezeReference));
	return Object.freeze({
		conditionReads: Object.freeze([...conditionReads]),
		rhsReads: references,
		actionWrites: Object.freeze([...actionWrites]),
		...(actionWritesUnknown ? { actionWritesUnknown: true as const } : {}),
		bindingReads: Object.freeze(references.filter(({ source }) => source === "binding")),
	});
}

function freezeReference<T extends ArbitreReference>(reference: T): T {
	return Object.freeze({ ...reference }) as T;
}
