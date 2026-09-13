import type { WriteRecord } from "./contracts.js";
import { ArbiterError, ArbiterErrorCode } from "./errors.js";
import type { ScopeProvenance } from "./scope-provenance.js";
import type { ScopeStorage } from "./scope-storage.js";
import { isRecord } from "./type-guards.js";

export class ScopeWrites {
	constructor(
		private readonly storage: ScopeStorage,
		private readonly provenance: ScopeProvenance,
	) {}

	readonly set = (path: string, value: unknown, ruleName: string): WriteRecord | undefined => {
		return this.commit(path, value, this.storage.read(path), ruleName);
	};

	readonly unset = (path: string, ruleName: string): WriteRecord | undefined => {
		const previous = this.storage.read(path);
		if (!this.storage.delete(path)) return undefined;
		return this.provenance.record(path, undefined, previous, ruleName);
	};

	readonly push = (path: string, value: unknown, ruleName: string): WriteRecord | undefined => {
		const previous = this.storage.read(path);
		const next = Array.isArray(previous) ? [...previous, value] : [value];
		return this.commit(path, next, previous, ruleName);
	};

	readonly inc = (path: string, amount: unknown, ruleName: string): WriteRecord | undefined => {
		const previous = this.storage.read(path);
		if (typeof amount !== "number") {
			throw new ArbiterError(
				ArbiterErrorCode.EXPRESSION_EVALUATION_FAILED,
				`inc requires a numeric amount, got ${typeof amount}`,
			);
		}
		const base = typeof previous === "number" ? previous : 0;
		return this.commit(path, base + amount, previous, ruleName);
	};

	readonly merge = (path: string, value: unknown, ruleName: string): WriteRecord | undefined => {
		const current = this.storage.read(path);
		if (!isRecord(value)) {
			throw new ArbiterError(ArbiterErrorCode.EXPRESSION_EVALUATION_FAILED, "merge requires a plain object value");
		}
		const previous = safeClone(current);
		const base = isRecord(current) ? current : {};
		return this.commit(path, { ...base, ...value }, previous, ruleName);
	};

	private commit(path: string, value: unknown, previous: unknown, ruleName: string): WriteRecord | undefined {
		if (!this.storage.write(path, value)) return undefined;
		return this.provenance.record(path, value, previous, ruleName);
	}
}

function safeClone(value: unknown): unknown {
	if (value === undefined || value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return [...value];
	return structuredClone(value);
}
