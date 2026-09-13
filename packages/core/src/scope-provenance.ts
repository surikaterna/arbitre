import type { WriteRecord } from "./contracts.js";

export class ScopeProvenance {
	private readonly records = new Map<string, WriteRecord[]>();
	private readonly snapshots = new Map<string, unknown>();
	private readonly snapshotKeysByRule = new Map<string, Set<string>>();

	constructor(private readonly restorePath: (path: string, value: unknown) => void) {}

	record(path: string, value: unknown, previousValue: unknown, ruleName: string): WriteRecord {
		const key = snapshotKey(ruleName, path);
		if (!this.snapshots.has(key)) this.captureSnapshot(key, ruleName, previousValue);
		const record = { path, value, snapshotValue: this.snapshots.get(key), ruleName };
		const records = this.records.get(ruleName);
		if (records) records.push(record);
		else this.records.set(ruleName, [record]);
		return record;
	}

	readonly getWriteRecords = (ruleName: string): readonly WriteRecord[] => {
		return this.records.get(ruleName) ?? [];
	};

	readonly revertRule = (ruleName: string): readonly string[] => {
		const records = this.records.get(ruleName);
		if (!records || records.length === 0) return [];
		const paths: string[] = [];
		for (const record of records) {
			this.restorePath(record.path, record.snapshotValue);
			paths.push(record.path);
		}
		this.records.delete(ruleName);
		this.clearSnapshots(ruleName);
		return paths;
	};

	readonly clearWriteRecords = (ruleName: string): void => {
		this.records.delete(ruleName);
		this.clearSnapshots(ruleName);
	};

	clear(): void {
		this.records.clear();
		this.snapshots.clear();
		this.snapshotKeysByRule.clear();
	}

	private captureSnapshot(key: string, ruleName: string, value: unknown): void {
		this.snapshots.set(key, safeClone(value));
		const keys = this.snapshotKeysByRule.get(ruleName);
		if (keys) keys.add(key);
		else this.snapshotKeysByRule.set(ruleName, new Set([key]));
	}

	private clearSnapshots(ruleName: string): void {
		const keys = this.snapshotKeysByRule.get(ruleName);
		if (!keys) return;
		for (const key of keys) this.snapshots.delete(key);
		this.snapshotKeysByRule.delete(ruleName);
	}
}

function snapshotKey(ruleName: string, path: string): string {
	return `${ruleName}:${path}`;
}

function safeClone(value: unknown): unknown {
	if (value === undefined || value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return [...value];
	return structuredClone(value);
}
