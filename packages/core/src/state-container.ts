const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type StateContainer = Record<string, unknown> | unknown[];

export class UnsafeStateContainerError extends TypeError {
	constructor(readonly reason: "accessor" | "malformed" | "uninspectable" | "unsupported" = "malformed") {
		super("State container is not descriptor-safe");
	}
}

export function materializeStateContainer(value: object): StateContainer {
	try {
		const array = Array.isArray(value);
		const prototype = selectedPrototype(array, Object.getPrototypeOf(value));
		if (prototype === undefined) throw new UnsafeStateContainerError("unsupported");
		const descriptors = Object.getOwnPropertyDescriptors(value);
		const normalized = normalizeDescriptors(descriptors, array);
		const result = array ? [] : (Object.create(prototype) as Record<string, unknown>);
		Object.defineProperties(result, normalized);
		return result;
	} catch (error) {
		if (error instanceof UnsafeStateContainerError) throw error;
		throw new UnsafeStateContainerError("uninspectable");
	}
}

export function isSupportedStateContainer(value: unknown): value is StateContainer {
	if (value === null || typeof value !== "object") return false;
	try {
		const array = Array.isArray(value);
		return selectedPrototype(array, Object.getPrototypeOf(value)) !== undefined;
	} catch {
		throw new UnsafeStateContainerError("uninspectable");
	}
}

export function defineTrustedValue(container: StateContainer, key: string, value: unknown): void {
	if (Array.isArray(container) && key === "length") {
		if (!Reflect.set(container, key, value)) throw new UnsafeStateContainerError();
		return;
	}
	Object.defineProperty(container, key, { configurable: true, enumerable: true, writable: true, value });
}

export function deleteTrustedValue(container: StateContainer, key: string): void {
	if (!Reflect.deleteProperty(container, key)) throw new UnsafeStateContainerError();
}

function selectedPrototype(array: boolean, prototype: object | null): object | null | undefined {
	if (array) return prototype === Array.prototype ? Array.prototype : undefined;
	if (prototype === null || prototype === Object.prototype) return prototype;
	return Object.getOwnPropertyDescriptor(prototype, "constructor") ? undefined : Object.prototype;
}

function normalizeDescriptors(descriptors: PropertyDescriptorMap, array: boolean): PropertyDescriptorMap {
	const normalized = Object.create(null) as PropertyDescriptorMap;
	for (const key of Reflect.ownKeys(descriptors)) {
		if (typeof key !== "string" || UNSAFE_KEYS.has(key)) throw new UnsafeStateContainerError();
		const descriptor = descriptors[key];
		if (!descriptor || !("value" in descriptor)) throw new UnsafeStateContainerError("accessor");
		if (array && key === "length") {
			if (!isValidArrayLength(descriptor.value)) throw new UnsafeStateContainerError();
			normalized[key] = { configurable: false, enumerable: false, writable: true, value: descriptor.value };
		} else {
			if (!descriptor.enumerable) throw new UnsafeStateContainerError();
			normalized[key] = { configurable: true, enumerable: true, writable: true, value: descriptor.value };
		}
	}
	return normalized;
}

function isValidArrayLength(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 4_294_967_295;
}
