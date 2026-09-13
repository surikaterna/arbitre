import type { ExprNode } from "kuery";
import { evaluate } from "kuery";
import type { Agenda } from "./agenda.js";
import type { Token } from "./beta-node.js";
import type { CompiledStage, StateChange, ThenOperatorRegistry } from "./contracts.js";
import { ArbiterError, ArbiterErrorCode } from "./errors.js";
import { evaluateArbitreValue } from "./expression-runtime.js";
import type { CompiledArbitreValue } from "./expression-types.js";
import type { ScopeManager } from "./scope.js";

export interface StageExecContext {
	readonly scope: ScopeManager;
	readonly agenda: Agenda;
	readonly thenOperators?: ThenOperatorRegistry | undefined;
	readonly token?: Token | undefined;
}

export function executeStages(
	stages: readonly CompiledStage[],
	ruleName: string,
	ctx: StageExecContext,
): StateChange[] {
	const changes: StateChange[] = [];
	for (const stage of stages) changes.push(...executeSingleStage(stage, ruleName, ctx));
	return changes;
}

function executeSingleStage(stage: CompiledStage, ruleName: string, ctx: StageExecContext): StateChange[] {
	switch (stage.operator) {
		case "$set":
			return executeValues(stage, ruleName, ctx, (path, value) => ctx.scope.set(path, value, ruleName));
		case "$inc":
			return executeValues(stage, ruleName, ctx, (path, value) => ctx.scope.inc(path, value, ruleName));
		case "$push":
			return executeValues(stage, ruleName, ctx, (path, value) => ctx.scope.push(path, value, ruleName));
		case "$merge":
			return executeValues(stage, ruleName, ctx, (path, value) => ctx.scope.merge(path, value, ruleName));
		case "$unset":
			return executeUnset(stage, ruleName, ctx);
		case "$pull":
			return executePull(stage, ruleName, ctx);
		case "$focus":
			ctx.agenda.setFocus(String(stage.entries.get("group") ?? ""));
			return [];
		default:
			return executeCustomOperator(stage, ruleName, ctx);
	}
}

function executeValues(
	stage: CompiledStage,
	ruleName: string,
	ctx: StageExecContext,
	write: (path: string, value: unknown) => void,
): StateChange[] {
	const changes: StateChange[] = [];
	for (const [path, compiled] of stage.entries) {
		const value = evaluateArbitreValue(compiled as CompiledArbitreValue, ctx.scope, ruleName, ctx.token);
		const previousValue = ctx.scope.get(path);
		write(path, value);
		changes.push({ path, previousValue, newValue: ctx.scope.get(path), ruleName });
	}
	return changes;
}

function executeUnset(stage: CompiledStage, ruleName: string, ctx: StageExecContext): StateChange[] {
	const changes: StateChange[] = [];
	for (const path of stage.entries.keys()) {
		const previousValue = ctx.scope.get(path);
		ctx.scope.unset(path, ruleName);
		changes.push({ path, previousValue, newValue: undefined, ruleName });
	}
	return changes;
}

function executePull(stage: CompiledStage, ruleName: string, ctx: StageExecContext): StateChange[] {
	const changes: StateChange[] = [];
	for (const [path, predicate] of stage.entries) {
		const previousValue = ctx.scope.get(path);
		if (!Array.isArray(previousValue)) continue;
		const value = previousValue.filter((item) => !evaluate(predicate as ExprNode, item as Record<string, unknown>));
		ctx.scope.set(path, value, ruleName);
		changes.push({ path, previousValue, newValue: value, ruleName });
	}
	return changes;
}

function executeCustomOperator(stage: CompiledStage, ruleName: string, ctx: StageExecContext): StateChange[] {
	const handler = ctx.thenOperators?.get(stage.operator);
	if (!handler) {
		throw new ArbiterError(ArbiterErrorCode.RULE_COMPILATION_FAILED, `Unknown then operator "${stage.operator}"`);
	}
	const changes: StateChange[] = [];
	handler(stage.entries, ctx.scope.getReadView(), (path, value) => {
		const previousValue = ctx.scope.get(path);
		ctx.scope.set(path, value, ruleName);
		changes.push({ path, previousValue, newValue: value, ruleName });
	});
	return changes;
}
