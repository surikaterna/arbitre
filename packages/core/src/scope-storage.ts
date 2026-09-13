import { collectPath } from "kuery";
import { splitPath, validatePath } from "./path-utils.js";
import { isRecord } from "./type-guards.js";

export interface ResolvedNamespace {
	readonly namespace: string;
	readonly localPath: string;
}

export class ScopeStorage {
	readonly registeredNamespaces: ReadonlySet<string>;
	private readonly stores: Record<string, Record<string, unknown>>;
	private cachedReadView: Record<string, unknown> | null = null;

	constructor(initialState?: Readonly<Record<string, unknown>>, namespaces?: readonly string[]) {
		this.registeredNamespaces = new Set(["$meta", ...(namespaces ?? [])]);
		this.stores = {
			root: initialState ? (structuredClone(initialState) as Record<string, unknown>) : {},
		};
		for (const namespace of this.registeredNamespaces) this.stores[namespace] = {};
	}

	readonly resolveNamespace = (path: string): ResolvedNamespace => {
		for (const namespace of this.registeredNamespaces) {
			if (path.startsWith(`${namespace}.`)) {
				return { namespace, localPath: path.slice(namespace.length + 1) };
			}
			if (path === namespace) return { namespace, localPath: "" };
		}
		return { namespace: "root", localPath: path };
	};

	readonly read = (path: string): unknown => {
		validatePath(path);
		const { namespace, localPath } = this.resolveNamespace(path);
		if (localPath === "") return this.store(namespace);
		return deepGet(this.store(namespace), splitPath(localPath));
	};

	readonly write = (path: string, value: unknown): boolean => {
		const target = this.writeTarget(path);
		if (!target) return false;
		deepSet(target.store, target.segments, value);
		this.cachedReadView = null;
		return true;
	};

	readonly delete = (path: string): boolean => {
		const target = this.writeTarget(path);
		if (!target) return false;
		deepDelete(target.store, target.segments);
		this.cachedReadView = null;
		return true;
	};

	readonly restorePath = (path: string, value: unknown): void => {
		if (value === undefined) this.delete(path);
		else this.write(path, structuredClone(value));
	};

	readonly getState = (): Readonly<Record<string, unknown>> => {
		return Object.freeze(this.assembleView());
	};

	readonly getReadView = (): Readonly<Record<string, unknown>> => {
		if (!this.cachedReadView) this.cachedReadView = this.assembleView();
		return this.cachedReadView;
	};

	readonly snapshot = (): unknown => structuredClone(this.stores);

	readonly restore = (snapshot: unknown): void => {
		const snapped = snapshot as Record<string, Record<string, unknown>>;
		for (const namespace of ["root", ...this.registeredNamespaces]) {
			const store = this.store(namespace);
			for (const key of Object.keys(store)) delete store[key];
			Object.assign(store, snapped[namespace]);
		}
		this.cachedReadView = null;
	};

	private store(namespace: string): Record<string, unknown> {
		return this.stores[namespace]!;
	}

	private writeTarget(path: string): { store: Record<string, unknown>; segments: readonly string[] } | undefined {
		validatePath(path);
		const { namespace, localPath } = this.resolveNamespace(path);
		if (localPath === "") return undefined;
		return { store: this.store(namespace), segments: splitPath(localPath) };
	}

	private assembleView(): Record<string, unknown> {
		const result: Record<string, unknown> = { ...this.store("root") };
		for (const namespace of this.registeredNamespaces) {
			const store = this.store(namespace);
			if (Object.keys(store).length > 0) result[namespace] = store;
		}
		return result;
	}
}

function deepGet(object: Record<string, unknown>, segments: readonly string[]): unknown {
	return collectPath(object, segments);
}

function deepSet(object: Record<string, unknown>, segments: readonly string[], value: unknown): void {
	let current = object;
	for (let index = 0; index < segments.length - 1; index++) {
		const segment = segments[index]!;
		const next = current[segment];
		if (isRecord(next)) current = next;
		else {
			const created: Record<string, unknown> = {};
			current[segment] = created;
			current = created;
		}
	}
	current[segments[segments.length - 1]!] = value;
}

function deepDelete(object: Record<string, unknown>, segments: readonly string[]): void {
	let current = object;
	for (let index = 0; index < segments.length - 1; index++) {
		const next = current[segments[index]!];
		if (!isRecord(next)) return;
		current = next;
	}
	delete current[segments[segments.length - 1]!];
}
