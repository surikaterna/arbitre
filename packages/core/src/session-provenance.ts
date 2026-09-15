import type { BetaEvaluator } from "./beta-evaluator.js";
import type { CompiledRule, FiringResult } from "./contracts.js";
import type { TruthMaintenanceSystem } from "./tms.js";

export function trackPatternRuleProvenance(
	result: FiringResult,
	rules: ReadonlyMap<string, CompiledRule>,
	evaluator: BetaEvaluator,
	tms: TruthMaintenanceSystem,
): void {
	for (const change of result.changes) {
		const rule = rules.get(change.ruleName);
		if (!rule?.hasPatterns) continue;
		const factIds = new Set<string>();
		for (const token of evaluator.getTokensForRule(rule.name)) {
			for (const fact of Object.values(token.factBindings)) factIds.add(fact.id);
		}
		if (factIds.size > 0) tms.recordFactDependency(rule.name, [...factIds]);
	}
}
