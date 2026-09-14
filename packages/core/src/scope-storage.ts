import { collectPath } from "kuery";
import { splitPath, validatePath } from "./path-utils.js";
import { cloneState } from "./state-clone.js";
import { isRecord } from "./type-guards.js";

export interface ResolvedNamespace {
	readonly namespace: string;
	readonly localPath: string;
}

export type OwnPathValue =
	| { readonly kind: "absent" }
	| { readonly kind: "data"; readonly value: unknown }
	| { readonly kind: "uninspectable" };

export class ScopeStorage {
	readonly registeredNamespaces: ReadonlySet<string>;
	private readonly stores: Record<string, Record<string, unknown>>;
	private cachedReadView: Record<string, unknown> | null = null;

	constructor(initialState?: Readonly<Record<string, unknown>>, namespaces?: readonly string[]) {
		this.registeredNamespaces = new Set(["$meta", ...(namespaces ?? [])]);
		this.stores = {
			root: initialState ? cloneState(initialState) : {},
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

	readonly readOwn = (path: string): OwnPathValue => {
		validatePath(path);
		const { namespace, localPath } = this.resolveNamespace(path);
		if (localPath === "") return { kind: "data", value: this.store(namespace) };
		return deepGetOwn(this.store(namespace), splitPath(localPath));
	};

	readonly hasOwn = (path: string): boolean => this.readOwn(path).kind !== "absent";

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
		else this.write(path, cloneState(value));
	};

	readonly getState = (): Readonly<Record<string, unknown>> => {
		return Object.freeze(this.assembleView());
	};

	readonly getReadView = (): Readonly<Record<string, unknown>> => {
		if (!this.cachedReadView) this.cachedReadView = this.assembleView();
		return this.cachedReadView;
	};

	readonly snapshot = (): unknown => cloneState(this.stores);

	readonly restore = (snapshot: unknown): void => {
		const snapped = cloneState(snapshot) as Record<string, Record<string, unknown>>;
		for (const namespace of ["root", ...this.registeredNamespaces]) {
			const store = this.store(namespace);
			replaceStore(store, snapped[namespace]!);
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

function deepGetOwn(object: Record<string, unknown>, segments: readonly string[]): OwnPathValue {
	let current: object = object;
	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index]!;
		const descriptor = inspectOwnProperty(current, segment);
		if (descriptor === null) return { kind: "uninspectable" };
		if (!descriptor) return { kind: "absent" };
		if (!("value" in descriptor)) return { kind: "uninspectable" };
		if (index === segments.length - 1) return { kind: "data", value: descriptor.value };
		if (descriptor.value === null || typeof descriptor.value !== "object") return { kind: "absent" };
		current = descriptor.value;
	}
	return { kind: "absent" };
}

function inspectOwnProperty(object: object, key: string): PropertyDescriptor | null | undefined {
	try {
		return Object.getOwnPropertyDescriptor(object, key);
	} catch {
		return null;
	}
}

function replaceStore(target: Record<string, unknown>, source: Record<string, unknown>): void {
	for (const key of Object.keys(target)) delete target[key];
	const descriptors = Object.getOwnPropertyDescriptors(source);
	for (const key of Object.keys(descriptors)) Object.defineProperty(target, key, descriptors[key]!);
}

function deepSet(object: Record<string, unknown>, segments: readonly string[], value: unknown): void {
	let current = object;
	for (let index = 0; index < segments.length - 1; index++) {
		const segment = segments[index]!;
		const descriptor = Object.getOwnPropertyDescriptor(current, segment);
		const next = descriptor && "value" in descriptor ? descriptor.value : undefined;
		if (isRecord(next)) current = next;
		else {
			const created: Record<string, unknown> = {};
			defineDataProperty(current, segment, created);
			current = created;
		}
	}
	defineDataProperty(current, segments[segments.length - 1]!, value);
}

function deepDelete(object: Record<string, unknown>, segments: readonly string[]): void {
	let current = object;
	for (let index = 0; index < segments.length - 1; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(current, segments[index]!);
		const next = descriptor && "value" in descriptor ? descriptor.value : undefined;
		if (!isRecord(next)) return;
		current = next;
	}
	delete current[segments[segments.length - 1]!];
}

function defineDataProperty(object: Record<string, unknown>, key: string, value: unknown): void {
	const descriptor = Object.getOwnPropertyDescriptor(object, key);
	if ((descriptor && "value" in descriptor && descriptor.writable) || (!descriptor && !Reflect.has(object, key))) {
		object[key] = value;
		return;
	}
	Object.defineProperty(object, key, { configurable: true, enumerable: true, writable: true, value });
}
