import type { DotPaths, ExprNode, PathValue, TypedQuery } from "kuery";
import type { CustomAccumulateFunction } from "./accumulate-functions.js";
import type { AccumulateConfig } from "./accumulate-node.js";
import type { ArbiterClock } from "./clock.js";
import type { ArbitreExpressionConfig, CompiledArbitreValue, RuleDependencies } from "./expression-types.js";
import type { CanonicalArbitreExpression } from "./expression-types.js";
import type { Fact } from "./fact-memory.js";
import type { CompiledPattern, FactPattern } from "./fact-pattern.js";
import type { SessionHooks } from "./hooks.js";
import type { SessionIntrospection } from "./introspection.js";
import type { ArbiterLogger } from "./logger.js";

export type { CompiledPattern } from "./fact-pattern.js";

import type { FactTypeDefinition } from "./fact-registry.js";
import type { ScheduleOptions } from "./timer-queue.js";

// ---------------------------------------------------------------------------
// ThenStage — MongoDB pipeline-style update operations (ADR §2.2)
// Each stage is a single-key object with a $-prefixed operator.
// Array ordering determines execution sequence.
// ---------------------------------------------------------------------------

/** Operator handler: receives field entries and scope, applies mutations. */
export type ThenOperatorHandler = (
	entries: ReadonlyMap<string, unknown>,
	scope: Readonly<Record<string, unknown>>,
	write: (path: string, value: unknown) => void,
) => void;

/** Registry for pluggable then operators. */
export interface ThenOperatorRegistry {
	readonly register: (name: string, handler: ThenOperatorHandler) => void;
	readonly get: (name: string) => ThenOperatorHandler | undefined;
	readonly has: (name: string) => boolean;
}

/** A single pipeline stage — one $-prefixed operator key. */
export type ThenStage<TState = Record<string, unknown>> = Readonly<Record<string, unknown>> & {
	/** Type-safe $set: paths are constrained to DotPaths<TState>. */
	readonly $set?: { readonly [P in DotPaths<TState>]?: ThenValue<PathValue<TState, P>> };
};

/** Expression or literal value — validated at compile time, not type level. */
export type ThenValue<T = unknown> =
	| T
	| string
	| Readonly<Record<string, unknown>>
	| CanonicalArbitreExpression
	| SwitchExpression
	| RelativeTimeExpression
	| AfterExpression
	| BeforeExpression
	| ElapsedExpression
	| WithinExpression;

export interface SwitchBranch {
	readonly case: ThenValue;
	readonly then: ThenValue;
}

export interface SwitchExpression {
	readonly $switch: {
		readonly branches: readonly SwitchBranch[];
		readonly default?: ThenValue | undefined;
	};
}

export interface RelativeTimeExpression {
	readonly $rtime: string;
}

export interface AfterExpression {
	readonly $after: ThenValue | readonly [ThenValue];
}

export interface BeforeExpression {
	readonly $before: ThenValue | readonly [ThenValue];
}

export interface ElapsedExpression {
	readonly $elapsed: readonly [ThenValue, ThenValue];
}

export interface WithinExpression {
	readonly $within: readonly [ThenValue, ThenValue];
}

// ---------------------------------------------------------------------------
// ProductionRule (ADR §2.1)
// ---------------------------------------------------------------------------

export interface ProductionRule<TState = Record<string, unknown>> {
	readonly name: string;
	readonly when: TypedQuery<TState>;
	readonly then: readonly ThenStage<TState>[];
	readonly else?: readonly ThenStage<TState>[] | undefined;
	readonly salience?: number | undefined;
	readonly activationGroup?: string | undefined;
	readonly onConflict?: "override" | "warn" | "error" | undefined;
	readonly enabled?: boolean | undefined;
	readonly description?: string | undefined;
	readonly expires?: number | undefined;
	readonly patterns?: readonly FactPattern[] | undefined;
	readonly accumulate?: readonly AccumulateConfig[] | undefined;
}

// ---------------------------------------------------------------------------
// Session configuration (ADR §3)
// ---------------------------------------------------------------------------

export interface SessionLimits {
	readonly maxCycles?: number | undefined;
	readonly maxRuleFirings?: number | undefined;
	readonly warnAtCycles?: number | undefined;
	readonly warnAtFirings?: number | undefined;
}

/** Configuration for a user-defined namespace */
export interface NamespaceConfig {
	/** The namespace prefix (must start with $, e.g., "$ui") */
	readonly name: string;
	/** Whether TMS auto-retracts writes in this namespace (default: true — inherits from TMS mode) */
	readonly autoRetract?: boolean;
}

/** TMS auto-retract configuration */
export interface TmsConfig {
	/**
	 * - "all" (default): auto-retract ALL writes when rule deactivates
	 * - "namespaces": only auto-retract writes to namespaces with autoRetract: true
	 * - "none": never auto-retract (user handles manually via else or external logic)
	 */
	readonly autoRetract?: "all" | "namespaces" | "none" | undefined;
}

export interface SessionConfig<TState = Record<string, unknown>> {
	readonly rules?: readonly ProductionRule<TState>[] | undefined;
	readonly initialState?: Readonly<Record<string, unknown>> | undefined;
	readonly expressions?: ArbitreExpressionConfig | undefined;
	readonly limits?: SessionLimits | undefined;
	readonly tms?: TmsConfig | undefined;
	readonly errorHandling?: "strict" | "lenient" | undefined;
	readonly thenOperators?: ThenOperatorRegistry | undefined;
	readonly factTypes?: readonly FactTypeDefinition[] | undefined;
	readonly accumulates?: readonly AccumulateConfig[] | undefined;
	readonly accumulateFunctions?: Readonly<Record<string, CustomAccumulateFunction>> | undefined;
	readonly clock?: ArbiterClock | undefined;
	readonly autoFireOnFactChange?: boolean | undefined;
	/** User-defined namespaces. $meta is always available as a built-in. */
	readonly namespaces?: readonly NamespaceConfig[] | undefined;
	readonly hooks?: SessionHooks | undefined;
	readonly logger?: ArbiterLogger | undefined;
}

// ---------------------------------------------------------------------------
// Firing result & diagnostics (ADR §3)
// ---------------------------------------------------------------------------

import type { ArbiterErrorCode } from "./errors.js";

export interface StateChange {
	readonly path: string;
	readonly previousValue: unknown;
	readonly newValue: unknown;
	readonly ruleName: string;
}

export interface ArbiterWarning {
	readonly code: ArbiterErrorCode;
	readonly message: string;
	readonly ruleName?: string | undefined;
}

export interface FiringResult {
	readonly rulesFired: number;
	readonly cycles: number;
	readonly changes: readonly StateChange[];
	readonly warnings: readonly ArbiterWarning[];
}

// ---------------------------------------------------------------------------
// RuleSession — main API surface (ADR §3)
// ---------------------------------------------------------------------------

export type SubscriptionCallback = (value: unknown, previousValue: unknown) => void;
export type Unsubscribe = () => void;

export interface RuleSession<TState = Record<string, unknown>> {
	readonly registerRule: (rule: ProductionRule<TState>) => void;
	readonly removeRule: (name: string) => void;
	readonly assert: (path: string, value: unknown) => void;
	readonly retract: (path: string) => void;
	readonly fire: () => FiringResult;

	readonly subscribe: (path: string, callback: SubscriptionCallback) => Unsubscribe;
	readonly update: (path: string, value: unknown) => FiringResult;

	readonly getState: () => Readonly<Record<string, unknown>>;
	readonly getPath: (path: string) => unknown;

	readonly setFocus: (group: string) => void;

	readonly dispose: () => void;

	readonly assertFact: (type: string, data: Readonly<Record<string, unknown>>) => string;
	readonly retractFact: (id: string) => boolean;
	readonly getFacts: (type: string) => readonly Fact[];

	readonly tick: (now?: number) => FiringResult;

	readonly scheduleRule: (ruleName: string, options: ScheduleOptions) => void;
	readonly cancelSchedule: (ruleName: string) => void;

	readonly introspect: SessionIntrospection;

	/** Create a checkpoint of the current session state. Returns an opaque snapshot. */
	readonly checkpoint: () => unknown;
	/** Restore session state to a previous checkpoint. Clears derived state (rule activation cache, agenda). */
	readonly rollback: (snapshot: unknown) => void;
}

// ---------------------------------------------------------------------------
// WriteRecord — TMS provenance tracking
// ---------------------------------------------------------------------------

export interface WriteRecord {
	readonly path: string;
	readonly value: unknown;
	readonly snapshotValue: unknown;
	readonly ruleName: string;
}

// ---------------------------------------------------------------------------
// Compiled internal types (not exported from main barrel)
// ---------------------------------------------------------------------------

export interface CompiledRule {
	readonly name: string;
	readonly condition: ExprNode;
	readonly actions: readonly CompiledStage[];
	readonly elseActions?: readonly CompiledStage[] | undefined;
	readonly salience: number;
	readonly activationGroup?: string | undefined;
	readonly onConflict: "override" | "warn" | "error";
	readonly enabled: boolean;
	readonly hasTms: boolean;
	readonly hasPatterns: boolean;
	readonly patterns?: readonly CompiledPattern[] | undefined;
	readonly accumulates?: readonly AccumulateConfig[] | undefined;
	readonly source: ProductionRule<unknown>;
	readonly dependencies: RuleDependencies;
}

export interface CompiledStage {
	readonly operator: string;
	readonly entries: ReadonlyMap<string, unknown | CompiledArbitreValue>;
}
