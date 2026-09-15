import { validateAndSplitPath } from "kuery";
import { ArbiterError, ArbiterErrorCode } from "./errors.js";

/**
 * Splits a dot-delimited path into segments.
 * For simple splitting without validation — use validatePath() when safety checks are needed.
 */
export function splitPath(path: string): readonly string[] {
	return path.split(".");
}

/**
 * Validates a path string for safety and correctness.
 * Throws ArbiterError on invalid or dangerous paths.
 */
export function validatePath(path: string): void {
	if (typeof path !== "string" || path.length === 0) {
		throw new ArbiterError(ArbiterErrorCode.INVALID_PATH, "Path must be a non-empty string");
	}
	try {
		const segments = validateAndSplitPath(path);
		if ((segments as readonly string[]).some((segment) => segment.length === 0)) throw new TypeError();
	} catch {
		throw new ArbiterError(ArbiterErrorCode.PROTOTYPE_POLLUTION, `Path "${path}" contains dangerous segment`);
	}
}

/**
 * Returns true if the path contains wildcard `*` segments.
 */
export function isWildcardPath(path: string): boolean {
	return splitPath(path).includes("*");
}

/**
 * Matches a wildcard pattern against a concrete path.
 * `*` matches a single segment.
 */
export function matchWildcardPath(pattern: string, concrete: string): boolean {
	const patternSegments = splitPath(pattern);
	const concreteSegments = splitPath(concrete);

	if (patternSegments.length !== concreteSegments.length) return false;

	return patternSegments.every((seg, i) => seg === "*" || seg === concreteSegments[i]);
}
