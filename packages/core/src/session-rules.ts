import { createAccumulateManager } from "./accumulate-manager.js";
import type { ProductionRule } from "./contracts.js";
import { createCrossTypeAccumulator } from "./cross-type-accumulate.js";
import { ArbiterError, ArbiterErrorCode } from "./errors.js";
import { compileRule } from "./rule-compiler.js";
import type { SessionKernel } from "./session-kernel.js";

export interface SessionRules<TState> {
	readonly register: (rule: ProductionRule<TState>) => void;
	readonly remove: (name: string) => void;
}

export function createSessionRules<TState>(
	kernel: SessionKernel<TState>,
	assertNotDisposed: () => void,
): SessionRules<TState> {
	function register(rule: ProductionRule<TState>): void {
		assertNotDisposed();
		const compiled = compileRule(rule as ProductionRule<unknown>, {
			customFnNames: kernel.customFnNames,
			namespaces: kernel.scope.getRegisteredNamespaces(),
			profile: kernel.expressionProfile,
			limits: kernel.config.expressions?.limits,
		});
		if (kernel.compiledRules.has(compiled.name)) duplicate(compiled.name);
		kernel.compiledRules.set(compiled.name, compiled);
		kernel.network.addRule(compiled);
		if (rule.expires !== undefined) kernel.expiryMap.set(rule.name, rule.expires);
		if (compiled.hasPatterns && compiled.patterns) {
			kernel.betaEvaluator.registerRule(compiled.name, rule.patterns ?? []);
		}
		registerAccumulates(kernel, compiled.accumulates);
	}

	function remove(name: string): void {
		assertNotDisposed();
		if (!kernel.compiledRules.has(name)) return;
		kernel.network.removeRule(name);
		kernel.agenda.removeActivation(name);
		kernel.tms.removeRule(name);
		kernel.scope.revertRule(name);
		kernel.scope.clearWriteRecords(name);
		kernel.ruleConditionState.delete(name);
		kernel.betaEvaluator.removeRule(name);
		kernel.compiledRules.delete(name);
	}

	return { register, remove };
}

function registerAccumulates<TState>(
	kernel: SessionKernel<TState>,
	accumulates:
		| import("./accumulate-node.js").AccumulateConfig[]
		| readonly import("./accumulate-node.js").AccumulateConfig[]
		| undefined,
): void {
	if (!accumulates?.length) return;
	if (!kernel.accumulateManager) {
		kernel.accumulateManager = createAccumulateManager([], kernel.config.accumulateFunctions, kernel.clock);
	}
	if (!kernel.crossTypeAccumulator) {
		kernel.crossTypeAccumulator = createCrossTypeAccumulator([], kernel.config.accumulateFunctions);
	}
	for (const accumulate of accumulates) kernel.accumulateManager.addConfig(accumulate);
}

function duplicate(name: string): never {
	throw new ArbiterError(ArbiterErrorCode.RULE_COMPILATION_FAILED, `Rule "${name}" is already registered`);
}
