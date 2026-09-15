import type { FiringResult, RuleSession, SessionConfig } from "./contracts.js";
import { ArbiterError, ArbiterErrorCode } from "./errors.js";
import { evaluateCondition } from "./fire-cycle.js";
import { emitHook } from "./hooks.js";
import { validatePath } from "./path-utils.js";
import { createCheckpointOperations } from "./session-checkpoint.js";
import { createAssertFact, createGetFacts, createRetractFact } from "./session-facts.js";
import { createSessionFire } from "./session-fire.js";
import { createSessionIntrospection } from "./session-introspection.js";
import { createSessionKernel, syncAggregates } from "./session-kernel.js";
import { createSessionRules } from "./session-rules.js";
import { createStateApi } from "./session-state-api.js";
import { createSessionSubscriptions } from "./session-subscriptions.js";
import { createCancelSchedule, createScheduleRule, createTick } from "./session-temporal.js";

export function createSession<TState = Record<string, unknown>>(
	config: SessionConfig<TState> = {},
): RuleSession<TState> {
	const kernel = createSessionKernel(config);
	const assertNotDisposed = createDisposalGuard(kernel.flags);
	const subscriptions = createSessionSubscriptions(assertNotDisposed);
	const rules = createSessionRules(kernel, assertNotDisposed);
	for (const rule of config.rules ?? []) rules.register(rule);
	const fire = createSessionFire(kernel, subscriptions, assertNotDisposed);
	const facts = createFactApi(kernel, assertNotDisposed, fire);
	const temporal = createTemporalApi(kernel, assertNotDisposed, fire);
	const state = createStateApi<TState>(assertNotDisposed, kernel.scope, kernel.agenda);
	const checkpoints = createCheckpointApi(kernel, assertNotDisposed);
	const introspect = createIntrospection(kernel);
	return {
		registerRule: rules.register,
		removeRule: rules.remove,
		...createMutationApi(kernel, assertNotDisposed, fire),
		subscribe: subscriptions.subscribe,
		...state,
		dispose: () => dispose(kernel, subscriptions),
		...facts,
		...temporal,
		introspect,
		...checkpoints,
	};
}

function createMutationApi<TState>(
	kernel: ReturnType<typeof createSessionKernel<TState>>,
	assertNotDisposed: () => void,
	fire: () => FiringResult,
) {
	const assert = (path: string, value: unknown) => {
		assertNotDisposed();
		validatePath(path);
		kernel.scope.set(path, value, "__assert__");
	};
	return {
		assert,
		retract: (path: string) => {
			assertNotDisposed();
			validatePath(path);
			kernel.scope.unset(path, "__assert__");
		},
		fire,
		update: (path: string, value: unknown) => {
			assert(path, value);
			return fire();
		},
	};
}

function createFactApi<TState>(
	kernel: ReturnType<typeof createSessionKernel<TState>>,
	assertNotDisposed: () => void,
	fire: () => FiringResult,
) {
	const deps = factDeps(kernel, assertNotDisposed, fire);
	const assertBase = createAssertFact(deps);
	const retractBase = createRetractFact(deps);
	return {
		assertFact: (type: string, data: Readonly<Record<string, unknown>>) => {
			const id = assertBase(type, data);
			kernel.metrics.totalFactsAsserted++;
			emitHook(kernel.config.hooks, "onFactAsserted", { factId: id, factType: type, data });
			return id;
		},
		retractFact: (id: string) => {
			const fact = kernel.factMemory?.getFact(id);
			const removed = retractBase(id);
			if (removed && fact) {
				kernel.metrics.totalFactsRetracted++;
				emitHook(kernel.config.hooks, "onFactRetracted", { factId: id, factType: fact.type });
			}
			return removed;
		},
		getFacts: createGetFacts(deps),
	};
}

function factDeps<TState>(
	kernel: ReturnType<typeof createSessionKernel<TState>>,
	assertNotDisposed: () => void,
	fire: () => FiringResult,
) {
	return {
		assertNotDisposed,
		factRegistry: kernel.factRegistry,
		factMemory: kernel.factMemory,
		accumulateManager: kernel.accumulateManager,
		crossTypeAccumulator: kernel.crossTypeAccumulator,
		tokenAccumulateManager: kernel.tokenAccumulateManager,
		betaEvaluator: kernel.betaEvaluator,
		scope: kernel.scope,
		compiledRules: kernel.compiledRules,
		agenda: kernel.agenda,
		tms: kernel.tms,
		pendingTokens: kernel.pendingTokens,
		syncAggregates: () => syncAggregates(kernel),
		evaluateCondition,
		autoFire: kernel.config.autoFireOnFactChange !== false,
		fire,
	};
}

function createTemporalApi<TState>(
	kernel: ReturnType<typeof createSessionKernel<TState>>,
	assertNotDisposed: () => void,
	fire: () => FiringResult,
) {
	const deps = {
		assertNotDisposed,
		clock: kernel.clock,
		timerQueue: kernel.timerQueue,
		expiryTracker: kernel.expiryTracker,
		accumulateManager: kernel.accumulateManager,
		scope: kernel.scope,
		compiledRules: kernel.compiledRules,
		agenda: kernel.agenda,
		ruleConditionState: kernel.ruleConditionState,
		syncAggregates: () => syncAggregates(kernel),
		fire,
	};
	return { tick: createTick(deps), scheduleRule: createScheduleRule(deps), cancelSchedule: createCancelSchedule(deps) };
}

function createCheckpointApi<TState>(
	kernel: ReturnType<typeof createSessionKernel<TState>>,
	assertNotDisposed: () => void,
) {
	return createCheckpointOperations({
		assertNotDisposed,
		scope: kernel.scope,
		ruleConditionState: kernel.ruleConditionState,
		clearAgenda: () => kernel.agenda.clear(),
		ruleNames: () => kernel.compiledRules.keys(),
		getTokens: (name) => kernel.betaEvaluator.getTokensForRule(name),
		tokenAccumulateManager: kernel.tokenAccumulateManager,
	});
}

function createIntrospection<TState>(kernel: ReturnType<typeof createSessionKernel<TState>>) {
	return createSessionIntrospection({
		agendaEntries: () => kernel.agenda.getActivations().map(({ rule }) => rule.name),
		compiledRules: kernel.compiledRules,
		ruleConditionState: kernel.ruleConditionState,
		factMemory: kernel.factMemory,
		factTypes: kernel.config.factTypes ?? [],
		getTokens: (name) => kernel.betaEvaluator.getTokensForRule(name),
		metrics: kernel.metrics,
		network: kernel.network,
	});
}

function createDisposalGuard(flags: { disposed: boolean }): () => void {
	return () => {
		if (flags.disposed) throw new ArbiterError(ArbiterErrorCode.SESSION_DISPOSED, "Session has been disposed");
	};
}

function dispose<TState>(
	kernel: ReturnType<typeof createSessionKernel<TState>>,
	subscriptions: ReturnType<typeof createSessionSubscriptions>,
): void {
	kernel.flags.disposed = true;
	kernel.compiledRules.clear();
	subscriptions.clear();
	kernel.ruleConditionState.clear();
}
