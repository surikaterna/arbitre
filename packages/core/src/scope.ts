import type { WriteRecord } from "./contracts.js";
import { ScopeProvenance } from "./scope-provenance.js";
import { ScopeStorage } from "./scope-storage.js";
import { ScopeWrites } from "./scope-writes.js";

export type Namespace = "root" | "$meta" | string;

export interface ScopeManager {
	readonly get: (path: string) => unknown;
	readonly hasOwn: (path: string) => boolean;
	readonly set: (path: string, value: unknown, ruleName: string) => WriteRecord | undefined;
	readonly unset: (path: string, ruleName: string) => WriteRecord | undefined;
	readonly push: (path: string, value: unknown, ruleName: string) => WriteRecord | undefined;
	readonly inc: (path: string, amount: unknown, ruleName: string) => WriteRecord | undefined;
	readonly merge: (path: string, value: unknown, ruleName: string) => WriteRecord | undefined;
	readonly getWriteRecords: (ruleName: string) => readonly WriteRecord[];
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
	const provenance = new ScopeProvenance(storage.restorePath);
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
		revertRule: provenance.revertRule,
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
	storage.restore(snapshot);
	provenance.clear();
}
