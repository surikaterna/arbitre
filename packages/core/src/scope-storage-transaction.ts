import {
	type StateContainer,
	UnsafeStateContainerError,
	defineTrustedValue,
	deleteTrustedValue,
	isSupportedStateContainer,
	materializeStateContainer,
} from "./state-container.js";

const BUCKET_COUNT = 32;
const materializedStores = new WeakMap<TrustedStore, Record<string, unknown>>();
const storeKeys = new WeakMap<TrustedStore, readonly string[]>();

interface StoreOrder {
	readonly parent?: StoreOrder | undefined;
	readonly base?: readonly string[] | undefined;
	readonly key?: string | undefined;
	readonly present?: boolean | undefined;
}

export interface TrustedStore {
	readonly prototype: object | null;
	readonly buckets: readonly Record<string, unknown>[];
	readonly order: StoreOrder;
	readonly size: number;
}

export type StoreSet = Record<string, TrustedStore>;
export type StoredPathValue = { readonly kind: "absent" } | { readonly kind: "data"; readonly value: unknown };
export type LeafMutation = { readonly kind: "write"; readonly value: unknown } | { readonly kind: "delete" };

export interface PreparedStoreMutation {
	readonly stores: StoreSet;
	readonly previous: StoredPathValue;
	readonly newValue: unknown;
}

export function createStoreSet(
	initialState: Readonly<Record<string, unknown>> | undefined,
	namespaces: Iterable<string>,
): StoreSet {
	const stores = Object.create(null) as StoreSet;
	stores.root = createTrustedStore(initialState ? asRecord(materializeStateContainer(initialState)) : {});
	for (const namespace of namespaces) stores[namespace] = createTrustedStore({});
	return stores;
}

export function createTrustedStore(source: Record<string, unknown>): TrustedStore {
	const buckets = Array.from({ length: BUCKET_COUNT }, createBucket);
	const descriptors = Object.getOwnPropertyDescriptors(source);
	for (const key of Object.keys(descriptors))
		defineTrustedValue(buckets[bucketIndex(key)]!, key, descriptors[key]!.value);
	const keys = Object.keys(descriptors);
	return { prototype: Object.getPrototypeOf(source), buckets, order: { base: keys }, size: keys.length };
}

export function prepareStoreMutation(
	stores: StoreSet,
	namespace: string,
	segments: readonly string[],
	createIntermediates: boolean,
	createMutation: (previous: StoredPathValue) => LeafMutation,
): PreparedStoreMutation {
	const store = stores[namespace]!;
	const key = segments[0]!;
	const index = bucketIndex(key);
	const bucket = cloneBucket(store.buckets[index]!);
	const descriptor = Object.getOwnPropertyDescriptor(bucket, key);
	const previous = descriptor ? { kind: "data" as const, value: descriptor.value } : { kind: "absent" as const };
	const rewritten =
		previous.kind === "absent" && createIntermediates
			? writeMissingStorePath(bucket, key, segments, createMutation(previous))
			: rewriteStoreEntry(bucket, key, previous, segments, createIntermediates, createMutation);
	const buckets = store.buckets.slice();
	buckets[index] = bucket;
	const nextStores = Object.assign(Object.create(null), stores) as StoreSet;
	const hasTopLevelValue = Object.hasOwn(bucket, key);
	const changedPresence = Boolean(descriptor) !== hasTopLevelValue;
	const order = changedPresence ? { parent: store.order, key, present: hasTopLevelValue } : store.order;
	const size = store.size + (changedPresence ? (hasTopLevelValue ? 1 : -1) : 0);
	nextStores[namespace] = { prototype: store.prototype, buckets, order, size };
	return { stores: nextStores, previous: rewritten.previous, newValue: rewritten.newValue };
}

function writeMissingStorePath(
	bucket: Record<string, unknown>,
	key: string,
	segments: readonly string[],
	mutation: LeafMutation,
): RewriteResult {
	if (mutation.kind === "delete") return { previous: { kind: "absent" }, newValue: undefined };
	let value = mutation.value;
	for (let index = segments.length - 1; index > 0; index--) {
		const parent: Record<string, unknown> = {};
		defineTrustedValue(parent, segments[index]!, value);
		value = parent;
	}
	defineTrustedValue(bucket, key, value);
	return { previous: { kind: "absent" }, newValue: mutation.value };
}

export function readTrustedStoreOwn(store: TrustedStore, key: string): StoredPathValue {
	const descriptor = Object.getOwnPropertyDescriptor(store.buckets[bucketIndex(key)]!, key);
	return descriptor ? { kind: "data", value: descriptor.value } : { kind: "absent" };
}

export function materializeTrustedStore(store: TrustedStore): Record<string, unknown> {
	const existing = materializedStores.get(store);
	if (existing) return existing;
	const result = Object.create(store.prototype) as Record<string, unknown>;
	for (const key of trustedStoreKeys(store))
		defineTrustedValue(result, key, storedValue(readTrustedStoreOwn(store, key)));
	materializedStores.set(store, result);
	return result;
}

export function trustedStoreKeys(store: TrustedStore): readonly string[] {
	const cached = storeKeys.get(store);
	if (cached) return cached;
	const changes: StoreOrder[] = [];
	let current = store.order;
	while (!current.base) {
		changes.push(current);
		current = current.parent!;
	}
	const ordered = new Map(current.base.map((key) => [key, true]));
	for (const change of changes.reverse()) {
		if (change.present) ordered.set(change.key!, true);
		else ordered.delete(change.key!);
	}
	const keys = [...ordered.keys()];
	storeKeys.set(store, keys);
	return keys;
}

export function appendToArray(value: unknown, appended: unknown): unknown[] {
	if (!Array.isArray(value)) return [appended];
	const result = materializeStateContainer(value);
	if (!Array.isArray(result)) throw new UnsafeStateContainerError();
	const length = Object.getOwnPropertyDescriptor(result, "length")!.value as number;
	defineTrustedValue(result, String(length), appended);
	return result;
}

interface RewriteResult {
	readonly previous: StoredPathValue;
	readonly newValue: unknown;
}

function rewriteStoreEntry(
	bucket: Record<string, unknown>,
	key: string,
	previous: StoredPathValue,
	segments: readonly string[],
	createIntermediates: boolean,
	createMutation: (previous: StoredPathValue) => LeafMutation,
): RewriteResult {
	if (segments.length === 1) return applyLeaf(bucket, key, previous, createMutation(previous));
	const child = prepareChild(previous, createIntermediates, createMutation, segments, 1);
	if (child) defineTrustedValue(bucket, key, child.container);
	return { previous: child?.previous ?? { kind: "absent" }, newValue: child?.newValue };
}

interface ChildRewriteResult extends RewriteResult {
	readonly container: StateContainer;
}

function rewriteContainer(
	source: StateContainer,
	segments: readonly string[],
	index: number,
	createIntermediates: boolean,
	createMutation: (previous: StoredPathValue) => LeafMutation,
): ChildRewriteResult {
	const container = materializeStateContainer(source);
	const key = segments[index]!;
	const descriptor = Object.getOwnPropertyDescriptor(container, key);
	const previous = descriptor ? { kind: "data" as const, value: descriptor.value } : { kind: "absent" as const };
	if (index === segments.length - 1)
		return { container, ...applyLeaf(container, key, previous, createMutation(previous)) };
	const child = prepareChild(previous, createIntermediates, createMutation, segments, index + 1);
	if (child) defineTrustedValue(container, key, child.container);
	return { container, previous: child?.previous ?? { kind: "absent" }, newValue: child?.newValue };
}

function prepareChild(
	previous: StoredPathValue,
	createIntermediates: boolean,
	createMutation: (previous: StoredPathValue) => LeafMutation,
	segments: readonly string[],
	index: number,
): ChildRewriteResult | undefined {
	if (previous.kind === "absent" || previous.value === null || typeof previous.value !== "object") {
		return createIntermediates ? rewriteFreshContainer(segments, index, createMutation) : undefined;
	}
	if (!isSupportedStateContainer(previous.value)) throw new UnsafeStateContainerError();
	return rewriteContainer(previous.value, segments, index, createIntermediates, createMutation);
}

function rewriteFreshContainer(
	segments: readonly string[],
	index: number,
	createMutation: (previous: StoredPathValue) => LeafMutation,
): ChildRewriteResult {
	const container: Record<string, unknown> = {};
	const key = segments[index]!;
	const previous = { kind: "absent" } as const;
	if (index === segments.length - 1)
		return { container, ...applyLeaf(container, key, previous, createMutation(previous)) };
	const child = rewriteFreshContainer(segments, index + 1, createMutation);
	defineTrustedValue(container, key, child.container);
	return { container, previous: child.previous, newValue: child.newValue };
}

function applyLeaf(
	container: StateContainer,
	key: string,
	previous: StoredPathValue,
	mutation: LeafMutation,
): RewriteResult {
	if (mutation.kind === "delete") deleteTrustedValue(container, key);
	else defineTrustedValue(container, key, mutation.value);
	return { previous, newValue: mutation.kind === "write" ? mutation.value : undefined };
}

function cloneBucket(source: Record<string, unknown>): Record<string, unknown> {
	return { ...source };
}

function createBucket(): Record<string, unknown> {
	return Object.create(null) as Record<string, unknown>;
}

function bucketIndex(key: string): number {
	const last = key.length - 1;
	const hash = key.length + key.charCodeAt(0) + key.charCodeAt(last) * 3 + key.charCodeAt(Math.max(0, last - 1)) * 7;
	return (hash >>> 0) % BUCKET_COUNT;
}

function asRecord(container: StateContainer): Record<string, unknown> {
	if (Array.isArray(container)) throw new UnsafeStateContainerError();
	return container;
}

function storedValue(value: StoredPathValue): unknown {
	return value.kind === "data" ? value.value : undefined;
}
