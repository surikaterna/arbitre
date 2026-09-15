import type { AlphaNetwork } from "./alpha-network.js";
import type { Token } from "./beta-node.js";
import type { CompiledRule } from "./contracts.js";
import type { FactMemory } from "./fact-memory.js";
import type { FactTypeDefinition } from "./fact-registry.js";
import type { SessionIntrospection, SessionMetrics } from "./introspection.js";

interface IntrospectionDeps {
	readonly agendaEntries: () => readonly string[];
	readonly compiledRules: ReadonlyMap<string, CompiledRule>;
	readonly ruleConditionState: ReadonlyMap<string, boolean>;
	readonly factMemory?: FactMemory | undefined;
	readonly factTypes: readonly FactTypeDefinition[];
	readonly getTokens: (ruleName: string) => readonly Token[];
	readonly metrics: SessionMetrics;
	readonly network: AlphaNetwork;
}

export function createSessionIntrospection(deps: IntrospectionDeps): SessionIntrospection {
	return {
		getAgendaEntries: deps.agendaEntries,
		getRegisteredRules: () => [...deps.compiledRules.keys()],
		getActiveRules: () => activeRules(deps.ruleConditionState),
		getFactCounts: () => factCounts(deps.factMemory, deps.factTypes),
		getTokenCounts: () => tokenCounts(deps.compiledRules, deps.getTokens),
		getMetrics: () => ({ ...deps.metrics }),
		getRuleDependencies: (ruleName) => deps.network.getRuleDependencies(ruleName),
	};
}

function activeRules(state: ReadonlyMap<string, boolean>): readonly string[] {
	const active: string[] = [];
	for (const [name, isActive] of state) if (isActive) active.push(name);
	return active;
}

function factCounts(
	memory: FactMemory | undefined,
	types: readonly FactTypeDefinition[],
): Readonly<Record<string, number>> {
	if (!memory) return {};
	const counts: Record<string, number> = {};
	for (const definition of types) {
		const count = memory.getFactsByType(definition.name).length;
		if (count > 0) counts[definition.name] = count;
	}
	return counts;
}

function tokenCounts(
	rules: ReadonlyMap<string, CompiledRule>,
	getTokens: (ruleName: string) => readonly Token[],
): Readonly<Record<string, number>> {
	const counts: Record<string, number> = {};
	for (const name of rules.keys()) {
		const count = getTokens(name).length;
		if (count > 0) counts[name] = count;
	}
	return counts;
}
