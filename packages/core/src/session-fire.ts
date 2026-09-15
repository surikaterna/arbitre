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
			const now = injectClock(kernel);
			const result = runCycle(kernel);
			updateExpiry(kernel, result, now);
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

function updateExpiry<TState>(kernel: SessionKernel<TState>, result: FiringResult, now: number | undefined): void {
	if (!kernel.expiryTracker || now === undefined) return;
	for (const ruleName of kernel.expiryMap.keys()) {
		if (!(kernel.ruleConditionState.get(ruleName) ?? false)) kernel.expiryTracker.reset(ruleName);
	}
	for (const change of result.changes) {
		if (kernel.expiryMap.has(change.ruleName)) kernel.expiryTracker.onRuleActivated(change.ruleName, now);
	}
}

function injectClock<TState>(kernel: SessionKernel<TState>): number | undefined {
	if (!kernel.clock) return undefined;
	let now: unknown;
	try {
		now = kernel.clock.now();
	} catch {
		invalidClock();
	}
	if (typeof now !== "number" || !Number.isFinite(now)) invalidClock();
	kernel.scope.set("$meta.$now", now, "__clock__");
	return now;
}

function invalidClock(): never {
	throw new ArbiterError(ArbiterErrorCode.INVALID_CLOCK_OPERATION, "Configured clock returned an invalid time");
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
