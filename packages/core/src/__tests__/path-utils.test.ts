import { describe, expect, it } from "vitest";
import { isWildcardPath, matchWildcardPath, splitPath, validatePath } from "../path-utils.js";

describe("validatePath", () => {
	it("accepts normal paths", () => {
		expect(() => validatePath("a.b.c")).not.toThrow();
		expect(() => validatePath("items.0.weight")).not.toThrow();
		expect(() => validatePath("simple")).not.toThrow();
	});

	it("rejects __proto__", () => {
		expect(() => validatePath("a.__proto__.b")).toThrow("dangerous segment");
	});

	it("rejects constructor", () => {
		expect(() => validatePath("a.constructor.b")).toThrow("dangerous segment");
	});

	it("rejects prototype", () => {
		expect(() => validatePath("a.prototype.b")).toThrow("dangerous segment");
	});

	it("rejects empty string", () => {
		expect(() => validatePath("")).toThrow("non-empty string");
	});
});

describe("isWildcardPath", () => {
	it("detects items.*.weight", () => {
		expect(isWildcardPath("items.*.weight")).toBe(true);
	});

	it("returns false for items.0.weight", () => {
		expect(isWildcardPath("items.0.weight")).toBe(false);
	});
});

describe("matchWildcardPath", () => {
	it("matches items.*.weight against items.0.weight", () => {
		expect(matchWildcardPath("items.*.weight", "items.0.weight")).toBe(true);
	});

	it("does not match items.*.weight against items.0.name", () => {
		expect(matchWildcardPath("items.*.weight", "items.0.name")).toBe(false);
	});

	it("matches multi-wildcard a.*.b.*.c", () => {
		expect(matchWildcardPath("a.*.b.*.c", "a.1.b.2.c")).toBe(true);
	});

	it("does not match different lengths", () => {
		expect(matchWildcardPath("a.*.b", "a.1.b.c")).toBe(false);
	});
});

describe("splitPath", () => {
	it("splits correctly", () => {
		expect(splitPath("a.b.c")).toEqual(["a", "b", "c"]);
	});

	it("handles single segment", () => {
		expect(splitPath("foo")).toEqual(["foo"]);
	});
});
