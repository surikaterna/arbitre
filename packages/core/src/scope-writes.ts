import type { WriteRecord } from "./contracts.js";
import { ArbiterError, ArbiterErrorCode } from "./errors.js";
import type { ScopeProvenance } from "./scope-provenance.js";
import type { ScopeStorage } from "./scope-storage.js";
import { cloneState } from "./state-clone.js";

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

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
		let inspected: ReturnType<ScopeStorage["readOwn"]>;
		try {
			inspected = this.storage.readOwn(path);
		} catch {
			throwWriteError("inc", path, ruleName, "existing value could not be inspected");
		}
		if (!isFiniteNumber(amount)) throwWriteError("inc", path, ruleName, "amount must be finite");
		if (inspected.kind === "uninspectable") {
			throwWriteError("inc", path, ruleName, "existing value is not a data property");
		}
		if (inspected.kind === "data" && !isFiniteNumber(inspected.value)) {
			throwWriteError("inc", path, ruleName, "existing value must be finite");
		}
		const base = inspected.kind === "data" ? (inspected.value as number) : 0;
		const result = base + amount;
		if (!Number.isFinite(result)) throwWriteError("inc", path, ruleName, "result must be finite");
		return this.commit(path, result, inspected.kind === "data" ? inspected.value : undefined, ruleName);
	};

	readonly merge = (path: string, value: unknown, ruleName: string): WriteRecord | undefined => {
		try {
			const current = this.storage.readOwn(path);
			const rhs = inspectPlainDataObject(value);
			if (current.kind === "uninspectable") throw new Error("target is not data");
			const target = current.kind === "data" ? inspectPlainDataObject(current.value) : undefined;
			const merged = target ? materializeObject(target.prototype, target, rhs) : materializeObject(rhs.prototype, rhs);
			const previous = target ? cloneState(materializeObject(target.prototype, target)) : undefined;
			return this.commit(path, merged, previous, ruleName);
		} catch {
			throwWriteError("merge", path, ruleName, "value must be a descriptor-safe plain object");
		}
	};

	private commit(path: string, value: unknown, previous: unknown, ruleName: string): WriteRecord | undefined {
		if (!this.storage.write(path, value)) return undefined;
		return this.provenance.record(path, value, previous, ruleName);
	}
}

interface InspectedObject {
	readonly prototype: object | null;
	readonly descriptors: PropertyDescriptorMap;
}

function inspectPlainDataObject(value: unknown): InspectedObject {
	if (value === null || typeof value !== "object") throw new Error("not an object");
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new Error("not plain");
	const keys = Reflect.ownKeys(value);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const key of keys) validateDescriptor(key, typeof key === "string" ? descriptors[key] : undefined);
	return { prototype, descriptors };
}

function validateDescriptor(key: PropertyKey, descriptor: PropertyDescriptor | undefined): void {
	if (typeof key !== "string" || UNSAFE_KEYS.has(key)) throw new Error("unsafe key");
	if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error("unsafe descriptor");
}

function materializeObject(prototype: object | null, ...sources: readonly InspectedObject[]): Record<string, unknown> {
	const result = Object.create(prototype) as Record<string, unknown>;
	for (const { descriptors } of sources) {
		for (const key of Object.keys(descriptors)) {
			Object.defineProperty(result, key, {
				configurable: true,
				enumerable: true,
				writable: true,
				value: descriptors[key]!.value,
			});
		}
	}
	return result;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function throwWriteError(operator: "inc" | "merge", path: string, ruleName: string, reason: string): never {
	throw new ArbiterError(
		ArbiterErrorCode.EXPRESSION_EVALUATION_FAILED,
		`${operator} failed for rule "${ruleName}" at ${path}`,
		{
			ruleName,
			details: { ruleName, path, reason },
		},
	);
}
