import { type PreparedProvenanceChange, ScopeProvenance } from "./scope-provenance.js";
import { type PreparedStorageChange, ScopeStorage } from "./scope-storage.js";
import { type ScopeMutationResult, ScopeWrites } from "./scope-writes.js";

export type Namespace = "root" | "$meta" | string;

export interface ScopeManager {
	readonly get: (path: string) => unknown;
	readonly hasOwn: (path: string) => boolean;
	readonly set: (path: string, value: unknown, ruleName: string) => ScopeMutationResult | undefined;
	readonly unset: (path: string, ruleName: string) => ScopeMutationResult | undefined;
	readonly push: (path: string, value: unknown, ruleName: string) => ScopeMutationResult | undefined;
	readonly inc: (path: string, amount: unknown, ruleName: string) => ScopeMutationResult | undefined;
	readonly merge: (path: string, value: unknown, ruleName: string) => ScopeMutationResult | undefined;
	readonly getWriteRecords: ScopeProvenance["getWriteRecords"];
	readonly revertRule: (ruleName: string) => readonly string[];
	readonly clearWriteRecords: (ruleName: string) => void;
	readonly getState: () => Readonly<Record<string, unknown>>;
	readonly getReadView: () => Readonly<Record<string, unknown>>;
	readonly snapshot: () => unknown;
	readonly restore: (snapshot: unknown) => void;
	readonly resolveNamespace: (path: string) => { namespace: string; localPath: string };
	readonly getRegisteredNamespaces: () => ReadonlySet<string>;
}

export function createScopeManager(
	initialState?: Readonly<Record<string, unknown>>,
	namespaces?: readonly string[],
): ScopeManager {
	const storage = new ScopeStorage(initialState, namespaces);
	const provenance = new ScopeProvenance();
	const writes = new ScopeWrites(storage, provenance);
	return assembleScopeManager(storage, provenance, writes);
}

function assembleScopeManager(storage: ScopeStorage, provenance: ScopeProvenance, writes: ScopeWrites): ScopeManager {
	return {
		get: storage.read,
		hasOwn: storage.hasOwn,
		set: writes.set,
		unset: writes.unset,
		push: writes.push,
		inc: writes.inc,
		merge: writes.merge,
		getWriteRecords: provenance.getWriteRecords,
		revertRule: (ruleName) => revertRule(ruleName, storage, provenance),
		clearWriteRecords: provenance.clearWriteRecords,
		getState: storage.getState,
		getReadView: storage.getReadView,
		snapshot: storage.snapshot,
		restore: (snapshot) => restoreScope(snapshot, storage, provenance),
		resolveNamespace: storage.resolveNamespace,
		getRegisteredNamespaces: () => storage.registeredNamespaces,
	};
}

function restoreScope(snapshot: unknown, storage: ScopeStorage, provenance: ScopeProvenance): void {
	const preparedStorage = storage.prepareRestore(snapshot);
	commitScopeChange(preparedStorage, provenance.prepareClear(), storage, provenance);
}

function revertRule(ruleName: string, storage: ScopeStorage, provenance: ScopeProvenance): readonly string[] {
	const preparedProvenance = provenance.prepareRevert(ruleName);
	if (!preparedProvenance) return [];
	const preparedStorage = storage.prepareRestorations(preparedProvenance.restorations);
	commitScopeChange(preparedStorage, preparedProvenance, storage, provenance);
	return preparedProvenance.paths;
}

function commitScopeChange(
	preparedStorage: PreparedStorageChange,
	preparedProvenance: PreparedProvenanceChange,
	storage: ScopeStorage,
	provenance: ScopeProvenance,
): void {
	let rollbackStorage: () => void;
	try {
		rollbackStorage = storage.commit(preparedStorage);
	} catch (error) {
		storage.rollback(preparedStorage);
		throw error;
	}
	try {
		provenance.commit(preparedProvenance);
	} catch (error) {
		provenance.rollback(preparedProvenance);
		rollbackStorage();
		throw error;
	}
}
