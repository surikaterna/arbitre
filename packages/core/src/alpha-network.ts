import type { CompiledRule } from "./contracts.js";
import type { RuleDependencies } from "./expression-types.js";
import { isWildcardPath, matchWildcardPath } from "./path-utils.js";

export interface AlphaNetwork {
	readonly getAffectedRules: (changedPath: string) => readonly CompiledRule[];
	readonly addRule: (rule: CompiledRule) => void;
	readonly removeRule: (ruleName: string) => void;
	readonly getRuleDependencies: (ruleName: string) => RuleDependencies | undefined;
}

interface WildcardEntry {
	readonly pattern: string;
	readonly rule: CompiledRule;
}

class AlphaNetworkIndex implements AlphaNetwork {
	private readonly exactIndex = new Map<string, Set<CompiledRule>>();
	private readonly wildcardEntries: WildcardEntry[] = [];
	private readonly ruleDeps = new Map<string, RuleDependencies>();
	private readonly rulesByName = new Map<string, CompiledRule>();

	readonly addRule = (rule: CompiledRule): void => {
		const dependencies = freezeDependencies(rule.dependencies);
		this.ruleDeps.set(rule.name, dependencies);
		this.rulesByName.set(rule.name, rule);

		for (const dep of dependencies.conditionReads) {
			if (isWildcardPath(dep)) {
				this.wildcardEntries.push({ pattern: dep, rule });
			} else {
				let set = this.exactIndex.get(dep);
				if (!set) {
					set = new Set();
					this.exactIndex.set(dep, set);
				}
				set.add(rule);
			}
		}
	};

	readonly removeRule = (ruleName: string): void => {
		const rule = this.rulesByName.get(ruleName);
		if (!rule) return;

		this.rulesByName.delete(ruleName);
		this.ruleDeps.delete(ruleName);

		for (const set of this.exactIndex.values()) {
			set.delete(rule);
		}

		for (let i = this.wildcardEntries.length - 1; i >= 0; i--) {
			if (this.wildcardEntries[i].rule === rule) {
				this.wildcardEntries.splice(i, 1);
			}
		}
	};

	readonly getAffectedRules = (changedPath: string): readonly CompiledRule[] => {
		const result = new Set<CompiledRule>();

		const exactSet = this.exactIndex.get(changedPath);
		if (exactSet) {
			for (const rule of exactSet) {
				result.add(rule);
			}
		}

		for (const entry of this.wildcardEntries) {
			if (matchWildcardPath(entry.pattern, changedPath)) {
				result.add(entry.rule);
			}
		}

		return [...result];
	};

	readonly getRuleDependencies = (ruleName: string): RuleDependencies | undefined => {
		return this.ruleDeps.get(ruleName);
	};
}

export function createAlphaNetwork(): AlphaNetwork {
	return new AlphaNetworkIndex();
}

function freezeDependencies(input: RuleDependencies): RuleDependencies {
	return Object.freeze({
		conditionReads: Object.freeze([...input.conditionReads]),
		rhsReads: Object.freeze(input.rhsReads.map((reference) => Object.freeze({ ...reference }))),
		actionWrites: Object.freeze([...input.actionWrites]),
		bindingReads: Object.freeze(input.bindingReads.map((reference) => Object.freeze({ ...reference }))),
	});
}
