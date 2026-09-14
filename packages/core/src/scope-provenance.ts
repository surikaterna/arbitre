import type { WriteRecord } from "./contracts.js";
import type { StoredPathValue } from "./scope-storage-transaction.js";
import type { PathRestoration } from "./scope-storage.js";
import { cloneState } from "./state-clone.js";

interface PreparedBase {
	readonly baseRevision: number;
	readonly kind: "record" | "remove" | "clear";
}

interface PreparedRecordChange extends PreparedBase {
	readonly kind: "record";
	readonly ruleName: string;
	readonly key: string;
	readonly priorRecords: readonly WriteRecord[] | undefined;
	readonly priorSnapshot: StoredPathValue | undefined;
	readonly priorKeys: ReadonlySet<string> | undefined;
	readonly snapshot: StoredPathValue;
	readonly record: WriteRecord;
}

interface PreparedRemoveChange extends PreparedBase {
	readonly kind: "remove";
	readonly ruleName: string;
	readonly records: readonly WriteRecord[];
	readonly snapshots: ReadonlyMap<string, StoredPathValue>;
	readonly keys: ReadonlySet<string>;
}

interface PreparedClearChange extends PreparedBase {
	readonly kind: "clear";
	readonly records: Map<string, readonly WriteRecord[]>;
	readonly snapshots: Map<string, StoredPathValue>;
	readonly snapshotKeysByRule: Map<string, ReadonlySet<string>>;
}

export type PreparedProvenanceChange = PreparedRecordChange | PreparedRemoveChange | PreparedClearChange;

export interface PreparedProvenanceRecord extends PreparedRecordChange {
	readonly record: WriteRecord;
}

export interface PreparedRuleRevert extends PreparedRemoveChange {
	readonly paths: readonly string[];
	readonly restorations: readonly PathRestoration[];
}

export class ScopeProvenance {
	private records = new Map<string, readonly WriteRecord[]>();
	private snapshots = new Map<string, StoredPathValue>();
	private snapshotKeysByRule = new Map<string, ReadonlySet<string>>();
	private revision = 0;

	prepareRecord(path: string, value: unknown, previous: StoredPathValue, ruleName: string): PreparedProvenanceRecord {
		const key = snapshotKey(ruleName, path);
		const priorSnapshot = this.snapshots.get(key);
		const snapshot = priorSnapshot ?? cloneStoredValue(previous);
		return {
			baseRevision: this.revision,
			kind: "record",
			ruleName,
			key,
			priorRecords: this.records.get(ruleName),
			priorSnapshot,
			priorKeys: this.snapshotKeysByRule.get(ruleName),
			snapshot,
			record: { path, value, snapshotValue: storedValue(snapshot), ruleName },
		};
	}

	prepareRevert(ruleName: string): PreparedRuleRevert | undefined {
		const records = this.records.get(ruleName);
		if (!records || records.length === 0) return undefined;
		const prepared = this.prepareRemove(ruleName, records);
		return {
			...prepared,
			paths: records.map((record) => record.path),
			restorations: records.map((record) => ({
				path: record.path,
				previous: this.snapshots.get(snapshotKey(ruleName, record.path))!,
			})),
		};
	}

	prepareClear(): PreparedProvenanceChange {
		return {
			baseRevision: this.revision,
			kind: "clear",
			records: this.records,
			snapshots: this.snapshots,
			snapshotKeysByRule: this.snapshotKeysByRule,
		};
	}

	commit(prepared: PreparedProvenanceChange): () => void {
		if (this.revision !== prepared.baseRevision) throw new Error("Stale provenance transaction");
		try {
			this.apply(prepared);
			this.revision++;
		} catch (error) {
			this.restore(prepared);
			throw error;
		}
		return () => this.rollback(prepared);
	}

	rollback(prepared: PreparedProvenanceChange): void {
		if (this.revision !== prepared.baseRevision + 1) return;
		this.restore(prepared);
		this.revision = prepared.baseRevision;
	}

	readonly getWriteRecords = (ruleName: string): readonly WriteRecord[] => this.records.get(ruleName) ?? [];

	readonly clearWriteRecords = (ruleName: string): void => {
		const records = this.records.get(ruleName);
		if (records) this.commit(this.prepareRemove(ruleName, records));
	};

	private prepareRemove(ruleName: string, records: readonly WriteRecord[]): PreparedRemoveChange {
		const keys = this.snapshotKeysByRule.get(ruleName) ?? new Set<string>();
		return {
			baseRevision: this.revision,
			kind: "remove",
			ruleName,
			records,
			keys,
			snapshots: new Map([...keys].map((key) => [key, this.snapshots.get(key)!])),
		};
	}

	private apply(prepared: PreparedProvenanceChange): void {
		if (prepared.kind === "record") this.applyRecord(prepared);
		else if (prepared.kind === "remove") this.removeRule(prepared.ruleName, prepared.keys);
		else {
			this.records = new Map();
			this.snapshots = new Map();
			this.snapshotKeysByRule = new Map();
		}
	}

	private applyRecord(prepared: PreparedRecordChange): void {
		this.records.set(prepared.ruleName, [...(prepared.priorRecords ?? []), prepared.record]);
		this.snapshots.set(prepared.key, prepared.snapshot);
		this.snapshotKeysByRule.set(prepared.ruleName, new Set([...(prepared.priorKeys ?? []), prepared.key]));
	}

	private removeRule(ruleName: string, keys: ReadonlySet<string>): void {
		this.records.delete(ruleName);
		for (const key of keys) this.snapshots.delete(key);
		this.snapshotKeysByRule.delete(ruleName);
	}

	private restore(prepared: PreparedProvenanceChange): void {
		if (prepared.kind === "record") {
			restoreRecord(this.records, this.snapshots, this.snapshotKeysByRule, prepared);
		} else if (prepared.kind === "remove") {
			restoreRemove(this.records, this.snapshots, this.snapshotKeysByRule, prepared);
		} else {
			this.records = prepared.records;
			this.snapshots = prepared.snapshots;
			this.snapshotKeysByRule = prepared.snapshotKeysByRule;
		}
	}
}

function restoreRecord(
	records: Map<string, readonly WriteRecord[]>,
	snapshots: Map<string, StoredPathValue>,
	keys: Map<string, ReadonlySet<string>>,
	prepared: PreparedRecordChange,
): void {
	setOrDelete(records, prepared.ruleName, prepared.priorRecords);
	setOrDelete(snapshots, prepared.key, prepared.priorSnapshot);
	setOrDelete(keys, prepared.ruleName, prepared.priorKeys);
}

function restoreRemove(
	records: Map<string, readonly WriteRecord[]>,
	snapshots: Map<string, StoredPathValue>,
	keys: Map<string, ReadonlySet<string>>,
	prepared: PreparedRemoveChange,
): void {
	records.set(prepared.ruleName, prepared.records);
	for (const [key, value] of prepared.snapshots) snapshots.set(key, value);
	keys.set(prepared.ruleName, prepared.keys);
}

function setOrDelete<K, V>(map: Map<K, V>, key: K, value: V | undefined): void {
	if (value === undefined) map.delete(key);
	else map.set(key, value);
}

function cloneStoredValue(value: StoredPathValue): StoredPathValue {
	return value.kind === "data" ? { kind: "data", value: cloneState(value.value) } : value;
}

function storedValue(value: StoredPathValue): unknown {
	return value.kind === "data" ? value.value : undefined;
}

function snapshotKey(ruleName: string, path: string): string {
	return `${ruleName}:${path}`;
}
