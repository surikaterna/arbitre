import { collectPath } from "kuery";
import { splitPath, validatePath } from "./path-utils.js";
import {
	type LeafMutation,
	type StoreSet,
	type StoredPathValue,
	type TrustedStore,
	createStoreSet,
	createTrustedStore,
	materializeTrustedStore,
	prepareStoreMutation,
	readTrustedStoreOwn,
	trustedStoreKeys,
} from "./scope-storage-transaction.js";
import { cloneState } from "./state-clone.js";
import { isSupportedStateContainer, materializeStateContainer } from "./state-container.js";

export interface ResolvedNamespace {
	readonly namespace: string;
	readonly localPath: string;
}

export type OwnPathValue = StoredPathValue | { readonly kind: "uninspectable" };

export interface PreparedStorageChange {
	readonly base: StoreSet;
	readonly baseCache: Record<string, unknown> | null;
	readonly next: StoreSet;
	readonly previous: StoredPathValue;
	readonly newValue: unknown;
}

export interface PathRestoration {
	readonly path: string;
	readonly previous: StoredPathValue;
}

export class ScopeStorage {
	readonly registeredNamespaces: ReadonlySet<string>;
	private stores: StoreSet;
	private cachedReadView: Record<string, unknown> | null = null;

	constructor(initialState?: Readonly<Record<string, unknown>>, namespaces?: readonly string[]) {
		this.registeredNamespaces = new Set(["$meta", ...(namespaces ?? [])]);
		this.stores = createStoreSet(initialState, this.registeredNamespaces);
	}

	readonly resolveNamespace = (path: string): ResolvedNamespace => {
		for (const namespace of this.registeredNamespaces) {
			if (path.startsWith(`${namespace}.`)) return { namespace, localPath: path.slice(namespace.length + 1) };
			if (path === namespace) return { namespace, localPath: "" };
		}
		return { namespace: "root", localPath: path };
	};

	readonly read = (path: string): unknown => {
		validatePath(path);
		const { namespace, localPath } = this.resolveNamespace(path);
		if (localPath === "") return readonlyStoreView(this.store(namespace));
		const [first, ...remaining] = splitPath(localPath);
		const value = readTrustedStoreOwn(this.store(namespace), first!);
		if (value.kind === "absent") return undefined;
		return remaining.length === 0 ? value.value : collectPath(value.value, remaining);
	};

	readonly readOwn = (path: string): OwnPathValue => {
		validatePath(path);
		const { namespace, localPath } = this.resolveNamespace(path);
		if (localPath === "") return { kind: "data", value: this.store(namespace) };
		const [first, ...remaining] = splitPath(localPath);
		const value = readTrustedStoreOwn(this.store(namespace), first!);
		if (value.kind === "absent" || remaining.length === 0) return value;
		if (value.value === null || typeof value.value !== "object") return { kind: "absent" };
		return deepGetOwn(value.value as Record<string, unknown>, remaining);
	};

	readonly hasOwn = (path: string): boolean => this.readOwn(path).kind !== "absent";

	prepareMutation(
		path: string,
		createIntermediates: boolean,
		createMutation: (previous: StoredPathValue) => LeafMutation,
	): PreparedStorageChange | undefined {
		const target = this.pathTarget(path);
		if (!target) return undefined;
		const prepared = prepareStoreMutation(
			this.stores,
			target.namespace,
			target.segments,
			createIntermediates,
			createMutation,
		);
		return {
			base: this.stores,
			baseCache: this.cachedReadView,
			next: prepared.stores,
			previous: prepared.previous,
			newValue: prepared.newValue,
		};
	}

	prepareRestorations(restorations: readonly PathRestoration[]): PreparedStorageChange {
		let next = this.stores;
		for (const restoration of restorations) next = this.restoreInto(next, restoration);
		return {
			base: this.stores,
			baseCache: this.cachedReadView,
			next,
			previous: { kind: "absent" },
			newValue: undefined,
		};
	}

	prepareRestore(snapshot: unknown): PreparedStorageChange {
		const next = this.materializeSnapshot(snapshot);
		return {
			base: this.stores,
			baseCache: this.cachedReadView,
			next,
			previous: { kind: "absent" },
			newValue: undefined,
		};
	}

	commit(prepared: PreparedStorageChange): () => void {
		if (this.stores !== prepared.base) throw new Error("Stale storage transaction");
		this.stores = prepared.next;
		this.cachedReadView = null;
		return () => this.rollback(prepared);
	}

	rollback(prepared: PreparedStorageChange): void {
		if (this.stores !== prepared.next) return;
		this.stores = prepared.base;
		this.cachedReadView = prepared.baseCache;
	}

	readonly getState = (): Readonly<Record<string, unknown>> => Object.freeze(this.assembleView());

	readonly getReadView = (): Readonly<Record<string, unknown>> => {
		if (!this.cachedReadView) this.cachedReadView = this.assembleView();
		return this.cachedReadView;
	};

	readonly snapshot = (): unknown => cloneState(this.materializeStores());

	private restoreInto(stores: StoreSet, restoration: PathRestoration): StoreSet {
		const { namespace, localPath } = this.resolveNamespace(restoration.path);
		if (localPath === "") return stores;
		const previous = restoration.previous;
		const mutation = () =>
			previous.kind === "data"
				? ({ kind: "write", value: cloneState(previous.value) } as const)
				: ({ kind: "delete" } as const);
		return prepareStoreMutation(stores, namespace, splitPath(localPath), previous.kind === "data", mutation).stores;
	}

	private materializeSnapshot(snapshot: unknown): StoreSet {
		if (!isSupportedStateContainer(snapshot) || Array.isArray(snapshot)) throw new TypeError("Invalid scope snapshot");
		const cloned = cloneState(snapshot);
		const next = Object.create(null) as StoreSet;
		for (const namespace of ["root", ...this.registeredNamespaces]) {
			const descriptor = Object.getOwnPropertyDescriptor(cloned, namespace);
			if (!descriptor || !("value" in descriptor) || !isSupportedStateContainer(descriptor.value)) {
				throw new TypeError("Invalid scope snapshot");
			}
			next[namespace] = createTrustedStore(materializeRecord(descriptor.value));
		}
		return next;
	}

	private pathTarget(path: string): { namespace: string; segments: readonly string[] } | undefined {
		validatePath(path);
		const { namespace, localPath } = this.resolveNamespace(path);
		return localPath === "" ? undefined : { namespace, segments: splitPath(localPath) };
	}

	private store(namespace: string): TrustedStore {
		return this.stores[namespace]!;
	}

	private assembleView(): Record<string, unknown> {
		const result: Record<string, unknown> = { ...materializeTrustedStore(this.store("root")) };
		for (const namespace of this.registeredNamespaces) {
			const store = this.store(namespace);
			if (store.size > 0) result[namespace] = readonlyStoreView(store);
		}
		return result;
	}

	private materializeStores(): Record<string, Record<string, unknown>> {
		const stores = Object.create(null) as Record<string, Record<string, unknown>>;
		for (const namespace of ["root", ...this.registeredNamespaces]) {
			stores[namespace] = materializeTrustedStore(this.store(namespace));
		}
		return stores;
	}
}

function deepGetOwn(object: Record<string, unknown>, segments: readonly string[]): OwnPathValue {
	let current: object = object;
	for (let index = 0; index < segments.length; index++) {
		const descriptor = inspectOwnProperty(current, segments[index]!);
		if (descriptor === null || (descriptor && !("value" in descriptor))) return { kind: "uninspectable" };
		if (!descriptor) return { kind: "absent" };
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

function materializeRecord(value: object): Record<string, unknown> {
	const materialized = materializeStateContainer(value);
	if (Array.isArray(materialized)) throw new TypeError("Invalid scope snapshot");
	return materialized;
}

const readonlyViews = new WeakMap<TrustedStore, Record<string, unknown>>();

function readonlyStoreView(store: TrustedStore): Record<string, unknown> {
	const existing = readonlyViews.get(store);
	if (existing) return existing;
	const view = new Proxy(Object.create(store.prototype) as Record<string, unknown>, {
		get: (_target, key) => (typeof key === "string" ? storedValue(readTrustedStoreOwn(store, key)) : undefined),
		has: (_target, key) => typeof key === "string" && readTrustedStoreOwn(store, key).kind === "data",
		ownKeys: () => [...trustedStoreKeys(store)],
		getOwnPropertyDescriptor: (_target, key) => viewDescriptor(store, key),
		set: () => false,
		defineProperty: () => false,
		deleteProperty: () => false,
		setPrototypeOf: () => false,
		preventExtensions: () => false,
	});
	readonlyViews.set(store, view);
	return view;
}

function viewDescriptor(store: TrustedStore, key: PropertyKey): PropertyDescriptor | undefined {
	if (typeof key !== "string") return undefined;
	const value = readTrustedStoreOwn(store, key);
	return value.kind === "data"
		? { configurable: true, enumerable: true, writable: false, value: value.value }
		: undefined;
}

function storedValue(value: StoredPathValue): unknown {
	return value.kind === "data" ? value.value : undefined;
}
