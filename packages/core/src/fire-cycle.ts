import { evaluate } from "kuery";
import type { Agenda } from "./agenda.js";
import type { AlphaNetwork } from "./alpha-network.js";
import type { Token } from "./beta-node.js";
import type { ArbiterWarning, CompiledRule, FiringResult, StateChange, ThenOperatorRegistry } from "./contracts.js";
import { ArbiterError, ArbiterErrorCode } from "./errors.js";
import { emitHook } from "./hooks.js";
import type { SessionHooks } from "./hooks.js";
import type { ArbiterLogger } from "./logger.js";
import type { ScopeManager } from "./scope.js";
import { executeStages } from "./stage-executor.js";
import type { TruthMaintenanceSystem } from "./tms.js";

// ---------------------------------------------------------------------------
// Limits config
// ---------------------------------------------------------------------------

export interface FireLimits {
	readonly maxCycles: number;
	readonly maxRuleFirings: number;
	readonly warnAtCycles: number;
	readonly warnAtFirings: number;
}

// ---------------------------------------------------------------------------
// Subsystem references needed by the fire cycle
// ---------------------------------------------------------------------------

export interface FireContext {
	readonly scope: ScopeManager;
	readonly network: AlphaNetwork;
	readonly agenda: Agenda;
	readonly tms: TruthMaintenanceSystem;
	readonly compiledRules: ReadonlyMap<string, CompiledRule>;
	readonly limits: FireLimits;
	readonly ruleConditionState: Map<string, boolean>;
	readonly thenOperators?: ThenOperatorRegistry | undefined;
	/** Token bindings pending injection for pattern-triggered rules */
	readonly pendingTokens?: Map<string, Token> | undefined;
	/** Tracks else-branch firing state across fire cycles */
	readonly elseTracking?: { wasActive: Set<string>; elseFired: Set<string> } | undefined;
	readonly hooks?: SessionHooks | undefined;
	readonly logger?: ArbiterLogger | undefined;
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

export function evaluateCondition(rule: CompiledRule, scope: ScopeManager): boolean {
	const state = scope.getReadView();
	const result = evaluate(rule.condition, state);
	return Boolean(result);
}

// ---------------------------------------------------------------------------
// TMS retraction → StateChange conversion
// ---------------------------------------------------------------------------

function buildRetractionChanges(rule: CompiledRule, ctx: FireContext): readonly StateChange[] {
	const revertedPaths = ctx.tms.ruleDeactivated(rule, ctx.scope);
	return revertedPaths.map((path) => ({
		path,
		newValue: ctx.scope.get(path),
		previousValue: undefined,
		ruleName: rule.name,
	}));
}

// ---------------------------------------------------------------------------
// Rule evaluation (single rule)
// ---------------------------------------------------------------------------

export function reevaluateRule(rule: CompiledRule, ctx: FireContext): readonly StateChange[] {
	if (!rule.enabled) return [];
	// Pattern-based rules are managed by beta evaluation, not scope propagation
	if (rule.hasPatterns) return [];
	const wasActive = ctx.ruleConditionState.get(rule.name) ?? false;
	const isActive = evaluateCondition(rule, ctx.scope);
	ctx.ruleConditionState.set(rule.name, isActive);

	if (isActive && !wasActive) {
		ctx.agenda.addActivation(rule);
		ctx.tms.ruleActivated(rule);
		ctx.elseTracking?.wasActive.add(rule.name);
		ctx.elseTracking?.elseFired.delete(rule.name);
		emitHook(ctx.hooks, "onRuleActivated", { ruleName: rule.name, timestamp: Date.now() });
	} else if (isActive && wasActive) {
		ctx.agenda.addActivation(rule);
	} else if (!isActive && wasActive) {
		ctx.agenda.removeActivation(rule.name);
		const retractionChanges = buildRetractionChanges(rule, ctx);
		const revertedPaths = retractionChanges.map((c) => c.path);
		emitHook(ctx.hooks, "onRuleDeactivated", { ruleName: rule.name, timestamp: Date.now(), revertedPaths });
		return retractionChanges;
	}
	return [];
}

// ---------------------------------------------------------------------------
// Evaluate all rules (initial pass)
// ---------------------------------------------------------------------------

export function evaluateAllRules(ctx: FireContext): readonly StateChange[] {
	const retractions: StateChange[] = [];
	for (const rule of ctx.compiledRules.values()) {
		if (!rule.enabled) continue;
		// Pattern-based rules are activated by fact assertions, not scope evaluation
		if (rule.hasPatterns) continue;
		const isActive = evaluateCondition(rule, ctx.scope);
		const wasActive = ctx.ruleConditionState.get(rule.name) ?? false;
		ctx.ruleConditionState.set(rule.name, isActive);

		if (isActive && !wasActive) {
			ctx.agenda.addActivation(rule);
			ctx.tms.ruleActivated(rule);
			ctx.elseTracking?.wasActive.add(rule.name);
			ctx.elseTracking?.elseFired.delete(rule.name);
			emitHook(ctx.hooks, "onRuleActivated", { ruleName: rule.name, timestamp: Date.now() });
		} else if (!isActive && wasActive) {
			ctx.agenda.removeActivation(rule.name);
			const retractionChanges = buildRetractionChanges(rule, ctx);
			const revertedPaths = retractionChanges.map((c) => c.path);
			emitHook(ctx.hooks, "onRuleDeactivated", { ruleName: rule.name, timestamp: Date.now(), revertedPaths });
			retractions.push(...retractionChanges);
		}
	}
	return retractions;
}

// ---------------------------------------------------------------------------
// Execute else actions for initially-false rules
// ---------------------------------------------------------------------------

export function executeElseBranches(ctx: FireContext, changes: StateChange[]): void {
	for (const rule of ctx.compiledRules.values()) {
		if (!rule.enabled || !rule.elseActions) continue;
		const isActive = ctx.ruleConditionState.get(rule.name) ?? false;
		if (isActive) continue;
		// Only fire else on transition from active → inactive (not for never-active rules)
		const wasEverActive = ctx.elseTracking?.wasActive.has(rule.name) ?? false;
		const alreadyFiredElse = ctx.elseTracking?.elseFired.has(rule.name) ?? false;
		if (!wasEverActive || alreadyFiredElse) continue;
		const elseChanges = executeStages(rule.elseActions, rule.name, ctx);
		changes.push(...elseChanges);
		ctx.elseTracking?.elseFired.add(rule.name);
	}
}

// ---------------------------------------------------------------------------
// Propagation: find affected rules and re-evaluate
// ---------------------------------------------------------------------------

function propagateChanges(changes: readonly StateChange[], ctx: FireContext, allChanges: StateChange[]): void {
	const affectedNames = new Set<string>();
	for (const change of changes) {
		for (const rule of ctx.network.getAffectedRules(change.path)) {
			affectedNames.add(rule.name);
		}
	}
	for (const name of affectedNames) {
		const rule = ctx.compiledRules.get(name);
		if (rule?.enabled) {
			const retractions = reevaluateRule(rule, ctx);
			allChanges.push(...retractions);
		}
	}
}

// ---------------------------------------------------------------------------
// Fact binding injection
// ---------------------------------------------------------------------------

const BINDING_PROVENANCE = "__binding__";

function injectFactBindings(token: Token, scope: ScopeManager): void {
	for (const [bindingName, fact] of Object.entries(token.factBindings)) {
		scope.set(`facts.${bindingName}`, fact.data, BINDING_PROVENANCE);
	}
}

function clearFactBindings(scope: ScopeManager): void {
	scope.unset("facts", BINDING_PROVENANCE);
}

// ---------------------------------------------------------------------------
// Main fire cycle
// ---------------------------------------------------------------------------

export function fireCycle(ctx: FireContext): FiringResult {
	const changes: StateChange[] = [];
	const warnings: ArbiterWarning[] = [];
	let rulesFired = 0;
	let cycles = 0;

	for (const c of evaluateAllRules(ctx)) {
		changes.push(c);
	}
	const elseStartIdx = changes.length;
	executeElseBranches(ctx, changes);
	const elseChanges = changes.slice(elseStartIdx);
	if (elseChanges.length > 0) {
		propagateChanges(elseChanges, ctx, changes);
	}

	while (!ctx.agenda.isEmpty()) {
		cycles++;
		const changesBeforeCycle = changes.length;

		emitHook(ctx.hooks, "onCycleStart", { cycleNumber: cycles, agendaSize: ctx.agenda.size() });

		if (cycles > ctx.limits.maxCycles) {
			throw new ArbiterError(
				ArbiterErrorCode.CYCLE_LIMIT_EXCEEDED,
				`Cycle limit of ${String(ctx.limits.maxCycles)} exceeded`,
			);
		}
		if (cycles === ctx.limits.warnAtCycles) {
			warnings.push({
				code: ArbiterErrorCode.CYCLE_LIMIT_EXCEEDED,
				message: `Approaching cycle limit (${String(cycles)}/${String(ctx.limits.maxCycles)})`,
			});
		}

		const rule = ctx.agenda.selectNext();
		if (!rule) break;

		// Inject fact bindings for pattern-triggered rules
		const token = ctx.pendingTokens?.get(rule.name);
		if (token) {
			injectFactBindings(token, ctx.scope);
			ctx.pendingTokens?.delete(rule.name);
		}

		const stageCtx = token ? { ...ctx, token } : ctx;
		const ruleChanges = executeStages(rule.actions, rule.name, stageCtx);
		changes.push(...ruleChanges);
		rulesFired++;

		emitHook(ctx.hooks, "onRuleFired", {
			ruleName: rule.name,
			timestamp: Date.now(),
			changes: ruleChanges,
			cycleNumber: cycles,
		});

		// Clear fact bindings after rule fires
		if (token) {
			clearFactBindings(ctx.scope);
		}

		if (rulesFired > ctx.limits.maxRuleFirings) {
			throw new ArbiterError(
				ArbiterErrorCode.FIRING_LIMIT_EXCEEDED,
				`Firing limit of ${String(ctx.limits.maxRuleFirings)} exceeded`,
			);
		}
		if (rulesFired === ctx.limits.warnAtFirings) {
			warnings.push({
				code: ArbiterErrorCode.FIRING_LIMIT_EXCEEDED,
				message: `Approaching firing limit (${String(rulesFired)}/${String(ctx.limits.maxRuleFirings)})`,
			});
		}

		propagateChanges(ruleChanges, ctx, changes);

		emitHook(ctx.hooks, "onCycleEnd", {
			cycleNumber: cycles,
			rulesFired: 1,
			changesInCycle: changes.length - changesBeforeCycle,
		});
	}

	return { rulesFired, cycles, changes, warnings };
}
