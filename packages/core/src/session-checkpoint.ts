import type { Token } from "./beta-node.js";
import type { ScopeManager } from "./scope.js";
import type { TokenAccumulateManager } from "./token-accumulate-manager.js";

interface CheckpointDeps {
	readonly assertNotDisposed: () => void;
	readonly scope: ScopeManager;
	readonly ruleConditionState: Map<string, boolean>;
	readonly clearAgenda: () => void;
	readonly ruleNames: () => Iterable<string>;
	readonly getTokens: (ruleName: string) => readonly Token[];
	readonly tokenAccumulateManager?: TokenAccumulateManager | undefined;
}

interface SessionSnapshot {
	readonly scope: unknown;
	readonly ruleConditionState: Map<string, boolean>;
	readonly tokenAccumulateSnapshot: Map<string, readonly Token[]>;
}

export function createCheckpointOperations(deps: CheckpointDeps): {
	readonly checkpoint: () => unknown;
	readonly rollback: (snapshot: unknown) => void;
} {
	function checkpoint(): unknown {
		deps.assertNotDisposed();
		return {
			scope: deps.scope.snapshot(),
			ruleConditionState: new Map(deps.ruleConditionState),
			tokenAccumulateSnapshot: snapshotTokens(deps),
		};
	}

	function rollback(snapshot: unknown): void {
		deps.assertNotDisposed();
		const state = snapshot as SessionSnapshot;
		deps.scope.restore(state.scope);
		deps.ruleConditionState.clear();
		for (const [key, value] of state.ruleConditionState) deps.ruleConditionState.set(key, value);
		deps.clearAgenda();
		if (!deps.tokenAccumulateManager) return;
		for (const [ruleName, tokens] of state.tokenAccumulateSnapshot) {
			deps.tokenAccumulateManager.recomputeForRule(ruleName, tokens);
		}
	}

	return { checkpoint, rollback };
}

function snapshotTokens(deps: CheckpointDeps): Map<string, readonly Token[]> {
	const snapshot = new Map<string, readonly Token[]>();
	for (const name of deps.ruleNames()) {
		const tokens = deps.getTokens(name);
		if (tokens.length > 0) snapshot.set(name, tokens);
	}
	return snapshot;
}
