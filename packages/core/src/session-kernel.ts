import type { ExpressionProfile } from "kuery/expression";
import { createAccumulateManager } from "./accumulate-manager.js";
import { createAgenda } from "./agenda.js";
import { createAlphaNetwork } from "./alpha-network.js";
import { createBetaEvaluator } from "./beta-evaluator.js";
import type { Token } from "./beta-node.js";
import type { CompiledRule, SessionConfig } from "./contracts.js";
import { createCrossTypeAccumulator } from "./cross-type-accumulate.js";
import { createExpiryTracker } from "./expiry-tracker.js";
import { createArbitreProfile } from "./expression-profile.js";
import { createFactMemory } from "./fact-memory.js";
import { createFactRegistry } from "./fact-registry.js";
import type { FireLimits } from "./fire-cycle.js";
import { createScopeManager } from "./scope.js";
import { createTimerQueue } from "./timer-queue.js";
import { createTms } from "./tms.js";
import { createTokenAccumulateManager } from "./token-accumulate-manager.js";

export interface SessionKernel<TState> {
	readonly config: SessionConfig<TState>;
	readonly scope: ReturnType<typeof createScopeManager>;
	readonly network: ReturnType<typeof createAlphaNetwork>;
	readonly agenda: ReturnType<typeof createAgenda>;
	readonly tms: ReturnType<typeof createTms>;
	readonly expressionProfile: ExpressionProfile;
	readonly factRegistry?: ReturnType<typeof createFactRegistry> | undefined;
	readonly factMemory?: ReturnType<typeof createFactMemory> | undefined;
	readonly betaEvaluator: ReturnType<typeof createBetaEvaluator>;
	readonly customFnNames?: ReadonlySet<string> | undefined;
	accumulateManager?: ReturnType<typeof createAccumulateManager> | undefined;
	crossTypeAccumulator?: ReturnType<typeof createCrossTypeAccumulator> | undefined;
	tokenAccumulateManager?: ReturnType<typeof createTokenAccumulateManager> | undefined;
	readonly compiledRules: Map<string, CompiledRule>;
	readonly ruleConditionState: Map<string, boolean>;
	readonly pendingTokens: Map<string, Token>;
	readonly elseTracking: { wasActive: Set<string>; elseFired: Set<string> };
	readonly flags: { disposed: boolean; firing: boolean };
	readonly metrics: {
		totalRulesFired: number;
		totalCycles: number;
		totalFactsAsserted: number;
		totalFactsRetracted: number;
	};
	readonly clock: SessionConfig<TState>["clock"];
	readonly timerQueue?: ReturnType<typeof createTimerQueue> | undefined;
	readonly expiryMap: Map<string, number>;
	readonly expiryTracker?: ReturnType<typeof createExpiryTracker> | undefined;
	readonly limits: FireLimits;
}

export function createSessionKernel<TState>(config: SessionConfig<TState> = {}): SessionKernel<TState> {
	const namespaceNames = config.namespaces?.map(({ name }) => name) ?? [];
	const autoRetract = new Set(
		(config.namespaces ?? []).filter((entry) => entry.autoRetract !== false).map(({ name }) => name),
	);
	const scope = createScopeManager(config.initialState, namespaceNames);
	const facts = createFactSupport(config);
	const accumulates = createAccumulateSupport(config);
	const temporal = createTemporalSupport(config);
	const flags = { disposed: false, firing: false };
	return {
		config,
		scope,
		network: createAlphaNetwork(),
		agenda: createAgenda(),
		tms: createTms(config.tms, autoRetract),
		expressionProfile: createArbitreProfile(config.expressions?.extensions),
		...facts,
		...accumulates,
		...temporal,
		compiledRules: new Map(),
		ruleConditionState: new Map(),
		pendingTokens: new Map(),
		elseTracking: { wasActive: new Set(), elseFired: new Set() },
		flags,
		metrics: { totalRulesFired: 0, totalCycles: 0, totalFactsAsserted: 0, totalFactsRetracted: 0 },
		limits: fireLimits(config),
	};
}

function createFactSupport<TState>(config: SessionConfig<TState>) {
	if (!config.factTypes)
		return { factRegistry: undefined, factMemory: undefined, betaEvaluator: createBetaEvaluator() };
	const factRegistry = createFactRegistry();
	for (const definition of config.factTypes) factRegistry.register(definition);
	return { factRegistry, factMemory: createFactMemory(), betaEvaluator: createBetaEvaluator() };
}

function createAccumulateSupport<TState>(config: SessionConfig<TState>) {
	const single = config.accumulates?.filter((entry) => !entry.binding || !entry.rule);
	const accumulateManager = single?.length
		? createAccumulateManager(single, config.accumulateFunctions, config.clock)
		: undefined;
	const crossTypeAccumulator = config.accumulates?.length
		? createCrossTypeAccumulator(config.accumulates, config.accumulateFunctions)
		: undefined;
	let tokenAccumulateManager = config.accumulates?.length
		? createTokenAccumulateManager(config.accumulates, config.accumulateFunctions)
		: undefined;
	if (tokenAccumulateManager && !tokenAccumulateManager.hasNodes()) tokenAccumulateManager = undefined;
	const customFnNames = config.accumulateFunctions ? new Set(Object.keys(config.accumulateFunctions)) : undefined;
	return { accumulateManager, crossTypeAccumulator, tokenAccumulateManager, customFnNames };
}

function createTemporalSupport<TState>(config: SessionConfig<TState>) {
	const expiryMap = new Map<string, number>();
	for (const rule of config.rules ?? []) if (rule.expires !== undefined) expiryMap.set(rule.name, rule.expires);
	const expiryTracker = config.clock && expiryMap.size ? createExpiryTracker(expiryMap) : undefined;
	return { clock: config.clock, timerQueue: config.clock ? createTimerQueue() : undefined, expiryMap, expiryTracker };
}

function fireLimits<TState>(config: SessionConfig<TState>): FireLimits {
	return {
		maxCycles: config.limits?.maxCycles ?? 100,
		maxRuleFirings: config.limits?.maxRuleFirings ?? 1000,
		warnAtCycles: config.limits?.warnAtCycles ?? 80,
		warnAtFirings: config.limits?.warnAtFirings ?? 800,
	};
}

export function syncAggregates<TState>(kernel: SessionKernel<TState>): void {
	const values: Record<string, unknown> = {};
	if (kernel.accumulateManager) Object.assign(values, kernel.accumulateManager.getAggregates());
	if (kernel.crossTypeAccumulator) Object.assign(values, kernel.crossTypeAccumulator.getValues());
	if (kernel.tokenAccumulateManager) Object.assign(values, kernel.tokenAccumulateManager.getValues());
	if (Object.keys(values).length) kernel.scope.set("$aggregates", values, "__accumulate__");
}
