import type { RuleDependencies } from "./expression-types.js";

export interface SessionMetrics {
	readonly totalRulesFired: number;
	readonly totalCycles: number;
	readonly totalFactsAsserted: number;
	readonly totalFactsRetracted: number;
}

export interface SessionIntrospection {
	/** Names of rules currently on the agenda */
	readonly getAgendaEntries: () => readonly string[];
	/** Names of all registered rules */
	readonly getRegisteredRules: () => readonly string[];
	/** Names of currently active rules (condition=true) */
	readonly getActiveRules: () => readonly string[];
	/** Number of facts by type in working memory */
	readonly getFactCounts: () => Readonly<Record<string, number>>;
	/** Number of tokens per rule in beta network */
	readonly getTokenCounts: () => Readonly<Record<string, number>>;
	/** Current fire cycle metrics */
	readonly getMetrics: () => SessionMetrics;
	/** Static reads/writes classified by role; only condition reads drive scheduling. */
	readonly getRuleDependencies: (ruleName: string) => RuleDependencies | undefined;
}
