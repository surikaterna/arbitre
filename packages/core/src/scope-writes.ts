import type { WriteRecord } from "./contracts.js";
import { ArbiterError, ArbiterErrorCode } from "./errors.js";
import type { ScopeProvenance } from "./scope-provenance.js";
import { type LeafMutation, type StoredPathValue, appendToArray } from "./scope-storage-transaction.js";
import type { PreparedStorageChange, ScopeStorage } from "./scope-storage.js";
import { UnsafeStateContainerError, defineTrustedValue, materializeStateContainer } from "./state-container.js";

export interface ScopeMutationResult extends WriteRecord {
	readonly previousValue: unknown;
	readonly newValue: unknown;
}

export class ScopeWrites {
	constructor(
		private readonly storage: ScopeStorage,
		private readonly provenance: ScopeProvenance,
	) {}

	readonly set = (path: string, value: unknown, ruleName: string): ScopeMutationResult | undefined => {
		return this.mutate(path, true, () => ({ kind: "write", value }), ruleName);
	};

	readonly unset = (path: string, ruleName: string): ScopeMutationResult | undefined => {
		return this.mutate(path, false, () => ({ kind: "delete" }), ruleName);
	};

	readonly push = (path: string, value: unknown, ruleName: string): ScopeMutationResult | undefined => {
		return this.mutate(
			path,
			true,
			(previous) => ({ kind: "write", value: appendToArray(storedValue(previous), value) }),
			ruleName,
		);
	};

	readonly inc = (path: string, amount: unknown, ruleName: string): ScopeMutationResult | undefined => {
		try {
			if (!isFiniteNumber(amount)) throw new Error("amount");
			return this.mutate(path, true, (previous) => increment(previous, amount), ruleName);
		} catch (error) {
			if (error instanceof ArbiterError) throw error;
			throwWriteError("inc", path, ruleName, incReason(error));
		}
	};

	readonly merge = (path: string, value: unknown, ruleName: string): ScopeMutationResult | undefined => {
		try {
			const rhs = inspectMergeObject(value);
			return this.mutate(path, true, (previous) => mergeValue(previous, rhs), ruleName);
		} catch (error) {
			if (error instanceof ArbiterError) throw error;
			throwWriteError("merge", path, ruleName, "value must be a descriptor-safe plain object");
		}
	};

	private mutate(
		path: string,
		createIntermediates: boolean,
		createMutation: (previous: StoredPathValue) => LeafMutation,
		ruleName: string,
	): ScopeMutationResult | undefined {
		const storage = this.storage.prepareMutation(path, createIntermediates, createMutation);
		if (!storage) return undefined;
		return this.commit(storage, path, ruleName);
	}

	private commit(storage: PreparedStorageChange, path: string, ruleName: string): ScopeMutationResult {
		const provenance = this.provenance.prepareRecord(path, storage.newValue, storage.previous, ruleName);
		let rollbackStorage: () => void;
		try {
			rollbackStorage = this.storage.commit(storage);
		} catch (error) {
			this.storage.rollback(storage);
			throw error;
		}
		try {
			this.provenance.commit(provenance);
		} catch (error) {
			this.provenance.rollback(provenance);
			rollbackStorage();
			throw error;
		}
		return {
			...provenance.record,
			previousValue: storedValue(storage.previous),
			newValue: storage.newValue,
		};
	}
}

function increment(previous: StoredPathValue, amount: number): LeafMutation {
	if (previous.kind === "data" && !isFiniteNumber(previous.value)) throw new Error("existing");
	const base = previous.kind === "data" ? (previous.value as number) : 0;
	const result = base + amount;
	if (!Number.isFinite(result)) throw new Error("result");
	return { kind: "write", value: result };
}

function incReason(error: unknown): string {
	if (error instanceof Error && error.message === "amount") return "amount must be finite";
	if (error instanceof Error && error.message === "existing") return "existing value must be finite";
	if (error instanceof Error && error.message === "result") return "result must be finite";
	if (error instanceof UnsafeStateContainerError && error.reason === "accessor") {
		return "existing value is not a data property";
	}
	return "existing value could not be inspected";
}

function inspectMergeObject(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not plain");
	const materialized = materializeStateContainer(value);
	if (Array.isArray(materialized)) throw new Error("not plain");
	return materialized;
}

function mergeValue(previous: StoredPathValue, rhs: Record<string, unknown>): LeafMutation {
	const target = previous.kind === "data" ? inspectMergeObject(previous.value) : undefined;
	const result = target ?? Object.create(Object.getPrototypeOf(rhs));
	for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(rhs))) {
		defineTrustedValue(result, key, descriptor.value);
	}
	return { kind: "write", value: result };
}

function storedValue(value: StoredPathValue): unknown {
	return value.kind === "data" ? value.value : undefined;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function throwWriteError(operator: "inc" | "merge", path: string, ruleName: string, reason: string): never {
	throw new ArbiterError(
		ArbiterErrorCode.EXPRESSION_EVALUATION_FAILED,
		`${operator} failed for rule "${ruleName}" at ${path}`,
		{ ruleName, details: { ruleName, path, reason } },
	);
}
