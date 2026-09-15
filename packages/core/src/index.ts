// Public types — rule definitions
// Public types — session configuration
// Public types — session API
// Public types — results & diagnostics

export type { AccumulateFn, CustomAccumulateFunction } from "./accumulate-functions.js";
// Accumulate support
export type { AccumulateConfig, AccumulateNode } from "./accumulate-node.js";
// Beta evaluator
export type { BetaEvaluator, FactActivation, FactDeactivation } from "./beta-evaluator.js";
export { createBetaEvaluator } from "./beta-evaluator.js";
// Beta network compilation
export type { AlphaFilterNode, BetaNetwork } from "./beta-network.js";
export { compileBetaNetwork } from "./beta-network.js";
// Beta/Join network
export type { BetaNode, Token } from "./beta-node.js";
export { tokenContainsFact } from "./beta-node.js";
// Clock abstraction
export type { ArbiterClock, VirtualClock } from "./clock.js";
export { createRealClock, createVirtualClock } from "./clock.js";
export type {
	ArbiterWarning,
	AfterExpression,
	BeforeExpression,
	ElapsedExpression,
	FiringResult,
	NamespaceConfig,
	ProductionRule,
	RuleSession,
	SessionConfig,
	SessionLimits,
	StateChange,
	SwitchBranch,
	SwitchExpression,
	SubscriptionCallback,
	ThenOperatorHandler,
	ThenOperatorRegistry,
	ThenStage,
	ThenValue,
	RelativeTimeExpression,
	TmsConfig,
	Unsubscribe,
	WriteRecord,
	WithinExpression,
} from "./contracts.js";
export type {
	ArbitreExpressionConfig,
	ArbitreReference,
	ArbitreValueExpression,
	CanonicalArbitreExpression,
	RuleDependencies,
} from "./expression-types.js";
export { expression, literal } from "./expression-types.js";
export { arbitreV1 } from "./expression-profile.js";
// Cross-type accumulation
export type { CrossTypeAccumulator } from "./cross-type-accumulate.js";
export { createCrossTypeAccumulator } from "./cross-type-accumulate.js";
// Error types
export { ArbiterError, ArbiterErrorCode } from "./errors.js";
// Fact support
export type { Fact, FactMemory } from "./fact-memory.js";
export type { CompiledPattern, FactPattern, JoinPredicate } from "./fact-pattern.js";
export type { FactFieldType, FactRegistry, FactTypeDefinition } from "./fact-registry.js";
// Hooks / Observability
export type {
	SessionHooks,
	RuleActivatedEvent,
	RuleDeactivatedEvent,
	RuleFiredEvent,
	FactAssertedEvent,
	FactRetractedEvent,
	CycleStartEvent,
	CycleEndEvent,
} from "./hooks.js";
export { emitHook } from "./hooks.js";
export type { ArbiterLogger } from "./logger.js";
export { nullLogger } from "./logger.js";
export type { SessionIntrospection, SessionMetrics } from "./introspection.js";
export type { InequalityConstraint, JoinConstraint, JoinNode, JoinNodeConfig } from "./join-node.js";
export { createJoinNode } from "./join-node.js";
// Rule builder
export { defineRule } from "./rule-builder.js";
export type { RuleBuilder } from "./rule-builder.js";
// Session factory
export { createSession } from "./session.js";
// Timer queue
export type { ScheduleOptions, TimerEntry, TimerQueue } from "./timer-queue.js";
export { createTimerQueue } from "./timer-queue.js";
export type { WindowedAccumulateConfig, WindowedAccumulateNode } from "./windowed-accumulate.js";
export { createWindowedAccumulateNode } from "./windowed-accumulate.js";
// Token-driven accumulation
export type { TokenAccumulateNode } from "./token-accumulate-node.js";
export { createTokenAccumulateNode, evaluateTokenExpr } from "./token-accumulate-node.js";
export type { TokenAccumulateManager } from "./token-accumulate-manager.js";
export { createTokenAccumulateManager } from "./token-accumulate-manager.js";
