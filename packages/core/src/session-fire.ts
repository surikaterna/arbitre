import type { FiringResult } from "./contracts.js";
import { ArbiterError, ArbiterErrorCode } from "./errors.js";
import type { FireContext } from "./fire-cycle.js";
import { fireCycle } from "./fire-cycle.js";
import type { SessionKernel } from "./session-kernel.js";
import { trackPatternRuleProvenance } from "./session-provenance.js";
import type { SessionSubscriptions } from "./session-subscriptions.js";

export function createSessionFire<TState>(
	kernel: SessionKernel<TState>,
	subscriptions: SessionSubscriptions,
	assertNotDisposed: () => void,
): () => FiringResult {
	return () => {
		assertNotDisposed();
		if (kernel.flags.firing) reentrant();
		kernel.flags.firing = true;
		try {
			injectClock(kernel);
			const result = runCycle(kernel);
			updateExpiry(kernel, result);
			trackPatternRuleProvenance(result, kernel.compiledRules, kernel.betaEvaluator, kernel.tms);
			subscriptions.notify(result.changes);
			kernel.metrics.totalRulesFired += result.rulesFired;
			kernel.metrics.totalCycles += result.cycles;
			return result;
		} finally {
			kernel.flags.firing = false;
		}
	};
}

function runCycle<TState>(kernel: SessionKernel<TState>): FiringResult {
	const snapshot = kernel.scope.snapshot();
	try {
		return fireCycle(fireContext(kernel));
	} catch (error) {
		if (isLimitError(error)) kernel.scope.restore(snapshot);
		throw error;
	}
}

function fireContext<TState>(kernel: SessionKernel<TState>): FireContext {
	const context: FireContext = {
		scope: kernel.scope,
		network: kernel.network,
		agenda: kernel.agenda,
		tms: kernel.tms,
		compiledRules: kernel.compiledRules,
		limits: kernel.limits,
		ruleConditionState: kernel.ruleConditionState,
		pendingTokens: kernel.pendingTokens,
		elseTracking: kernel.elseTracking,
		hooks: kernel.config.hooks,
		logger: kernel.config.logger,
	};
	return kernel.config.thenOperators ? { ...context, thenOperators: kernel.config.thenOperators } : context;
}

function updateExpiry<TState>(kernel: SessionKernel<TState>, result: FiringResult): void {
	if (!kernel.expiryTracker || !kernel.clock) return;
	for (const ruleName of kernel.expiryMap.keys()) {
		if (!(kernel.ruleConditionState.get(ruleName) ?? false)) kernel.expiryTracker.reset(ruleName);
	}
	for (const change of result.changes) {
		if (kernel.expiryMap.has(change.ruleName))
			kernel.expiryTracker.onRuleActivated(change.ruleName, kernel.clock.now());
	}
}

function injectClock<TState>(kernel: SessionKernel<TState>): void {
	if (kernel.clock) kernel.scope.set("$meta.$now", kernel.clock.now(), "__clock__");
}

function isLimitError(error: unknown): boolean {
	return (
		error instanceof ArbiterError &&
		(error.code === ArbiterErrorCode.CYCLE_LIMIT_EXCEEDED || error.code === ArbiterErrorCode.FIRING_LIMIT_EXCEEDED)
	);
}

function reentrant(): never {
	throw new ArbiterError(
		ArbiterErrorCode.REENTRANT_FIRE,
		"Cannot call fire() or update() while a fire cycle is in progress (e.g., from a subscribe callback)",
	);
}
