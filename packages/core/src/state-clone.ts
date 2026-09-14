export function cloneState<T>(value: T): T {
	return cloneValue(value, new Map()) as T;
}

function cloneValue(value: unknown, seen: Map<object, unknown>): unknown {
	if (value === null || typeof value !== "object") return value;
	const existing = seen.get(value);
	if (existing !== undefined) return existing;
	if (value instanceof Map) return cloneMap(value, seen);
	if (value instanceof Set) return cloneSet(value, seen);
	const prototype = Object.getPrototypeOf(value);
	if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return structuredClone(value);
	const clone = Array.isArray(value) ? [] : Object.create(prototype);
	seen.set(value, clone);
	copyEnumerableData(value, clone, seen);
	return clone;
}

function copyEnumerableData(source: object, target: object, seen: Map<object, unknown>): void {
	const descriptors = Object.getOwnPropertyDescriptors(source);
	for (const key of Object.keys(descriptors)) {
		const descriptor = descriptors[key]!;
		if (!descriptor.enumerable) continue;
		if (!("value" in descriptor)) throw new TypeError("State accessors cannot be cloned safely");
		Object.defineProperty(target, key, {
			configurable: true,
			enumerable: true,
			writable: true,
			value: cloneValue(descriptor.value, seen),
		});
	}
}

function cloneMap(source: Map<unknown, unknown>, seen: Map<object, unknown>): Map<unknown, unknown> {
	const clone = new Map<unknown, unknown>();
	seen.set(source, clone);
	for (const [key, value] of source) clone.set(cloneValue(key, seen), cloneValue(value, seen));
	return clone;
}

function cloneSet(source: Set<unknown>, seen: Map<object, unknown>): Set<unknown> {
	const clone = new Set<unknown>();
	seen.set(source, clone);
	for (const value of source) clone.add(cloneValue(value, seen));
	return clone;
}
