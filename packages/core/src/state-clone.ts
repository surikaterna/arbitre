import { UnsafeStateContainerError, defineTrustedValue, materializeStateContainer } from "./state-container.js";

export function cloneState<T>(value: T): T {
	return cloneValue(value, new Map()) as T;
}

function cloneValue(value: unknown, seen: Map<object, unknown>): unknown {
	if (value === null || typeof value !== "object") return value;
	const existing = seen.get(value);
	if (existing !== undefined) return existing;
	const clone = materializeForClone(value);
	if (!clone) return value;
	seen.set(value, clone);
	for (const key of Object.keys(Object.getOwnPropertyDescriptors(clone))) {
		if (Array.isArray(clone) && key === "length") continue;
		const descriptor = Object.getOwnPropertyDescriptor(clone, key)!;
		defineTrustedValue(clone, key, cloneValue(descriptor.value, seen));
	}
	return clone;
}

function materializeForClone(value: object) {
	try {
		return materializeStateContainer(value);
	} catch (error) {
		if (
			error instanceof UnsafeStateContainerError &&
			(error.reason === "uninspectable" || error.reason === "unsupported")
		) {
			return undefined;
		}
		throw error;
	}
}
