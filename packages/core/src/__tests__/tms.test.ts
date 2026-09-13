import { describe, expect, test } from "vitest";
import type { CompiledRule, WriteRecord } from "../contracts.js";
import type { ScopeManager } from "../scope.js";
import { createTms } from "../tms.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
	return {
		name: overrides.name ?? "test-rule",
		condition: {},
		actions: [],
		salience: 0,
		onConflict: "warn",
		enabled: true,
		hasTms: true,
		source: { name: "test-rule", when: {}, then: [] },
		dependencies: { conditionReads: [], rhsReads: [], actionWrites: [], bindingReads: [] },
		...overrides,
	};
}

function mockScope(writeRecords: readonly WriteRecord[] = [], revertedPaths: readonly string[] = []): ScopeManager {
	return {
		get: () => undefined,
		set: () => undefined,
		unset: () => undefined,
		push: () => undefined,
		inc: () => undefined,
		merge: () => undefined,
		getWriteRecords: () => writeRecords,
		revertRule: () => revertedPaths,
		clearWriteRecords: () => undefined,
		getState: () => ({}),
		snapshot: () => undefined,
		resolveNamespace: (path: string) => ({ namespace: "root" as const, localPath: path }),
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TMS", () => {
	describe("shouldTrack", () => {
		test("returns true for rule with hasTms=true", () => {
			const tms = createTms();
			expect(tms.shouldTrack(makeRule({ hasTms: true }))).toBe(true);
		});

		test("returns false for rule with hasTms=false", () => {
			const tms = createTms();
			expect(tms.shouldTrack(makeRule({ hasTms: false }))).toBe(false);
		});
	});

	describe("shouldAutoRetract policy", () => {
		test("all mode: all paths auto-retract", () => {
			const tms = createTms({ autoRetract: "all" });
			expect(tms.shouldAutoRetract("$ui.sidebar.visible")).toBe(true);
			expect(tms.shouldAutoRetract("user.name")).toBe(true);
		});

		test("none mode: no paths auto-retract", () => {
			const tms = createTms({ autoRetract: "none" });
			expect(tms.shouldAutoRetract("$ui.sidebar.visible")).toBe(false);
			expect(tms.shouldAutoRetract("user.name")).toBe(false);
		});

		test("namespaces mode: only registered namespace paths auto-retract", () => {
			const autoRetractNs = new Set(["$ui", "$contributions"]);
			const tms = createTms({ autoRetract: "namespaces" }, autoRetractNs);
			expect(tms.shouldAutoRetract("$ui.sidebar.visible")).toBe(true);
			expect(tms.shouldAutoRetract("$contributions.menu.items")).toBe(true);
			expect(tms.shouldAutoRetract("user.name")).toBe(false);
		});

		test("default mode is all", () => {
			const tms = createTms();
			expect(tms.shouldAutoRetract("user.name")).toBe(true);
			expect(tms.shouldAutoRetract("$ui.theme")).toBe(true);
		});
	});

	describe("activation tracking", () => {
		test("ruleActivated adds to active set", () => {
			const tms = createTms();
			const rule = makeRule({ name: "r1" });
			tms.ruleActivated(rule);
			expect(tms.getActiveRules().has("r1")).toBe(true);
		});

		test("getActiveRules returns currently active rules", () => {
			const tms = createTms();
			tms.ruleActivated(makeRule({ name: "a" }));
			tms.ruleActivated(makeRule({ name: "b" }));
			const active = tms.getActiveRules();
			expect(active.size).toBe(2);
			expect(active.has("a")).toBe(true);
			expect(active.has("b")).toBe(true);
		});

		test("ruleActivated skips untracked rules", () => {
			const tms = createTms();
			tms.ruleActivated(makeRule({ name: "no-tms", hasTms: false }));
			expect(tms.getActiveRules().size).toBe(0);
		});
	});

	describe("retraction", () => {
		test("ruleDeactivated triggers scope.revertRule for tracked rules", () => {
			const tms = createTms();
			const rule = makeRule({ name: "r1" });
			tms.ruleActivated(rule);

			const writes: WriteRecord[] = [{ path: "$ui.visible", value: true, snapshotValue: false, ruleName: "r1" }];
			const scope = mockScope(writes, ["$ui.visible"]);
			const paths = tms.ruleDeactivated(rule, scope);

			expect(paths).toEqual(["$ui.visible"]);
			expect(tms.getActiveRules().has("r1")).toBe(false);
		});

		test("ruleDeactivated returns affected paths", () => {
			const tms = createTms({ autoRetract: "all" });
			const rule = makeRule({ name: "r2" });
			tms.ruleActivated(rule);

			const writes: WriteRecord[] = [{ path: "count", value: 5, snapshotValue: 0, ruleName: "r2" }];
			const scope = mockScope(writes, ["count"]);
			const paths = tms.ruleDeactivated(rule, scope);

			expect(paths).toEqual(["count"]);
		});

		test("ruleDeactivated with untracked rule is a no-op", () => {
			const tms = createTms();
			const rule = makeRule({ name: "no-tms", hasTms: false });
			const scope = mockScope();
			const paths = tms.ruleDeactivated(rule, scope);
			expect(paths).toEqual([]);
		});

		test("ruleDeactivated with never-activated rule is a no-op", () => {
			const tms = createTms();
			const rule = makeRule({ name: "never" });
			const scope = mockScope();
			const paths = tms.ruleDeactivated(rule, scope);
			expect(paths).toEqual([]);
		});

		test("ruleDeactivated skips retraction when no writes in auto-retract namespaces", () => {
			const autoRetractNs = new Set(["$ui", "$contributions"]);
			const tms = createTms({ autoRetract: "namespaces" }, autoRetractNs);
			const rule = makeRule({ name: "root-only" });
			tms.ruleActivated(rule);

			const writes: WriteRecord[] = [
				{ path: "user.name", value: "Bob", snapshotValue: "Alice", ruleName: "root-only" },
			];
			const scope = mockScope(writes, ["user.name"]);
			const paths = tms.ruleDeactivated(rule, scope);

			expect(paths).toEqual([]);
			expect(tms.getActiveRules().has("root-only")).toBe(false);
		});
	});

	describe("cleanup", () => {
		test("removeRule clears TMS state", () => {
			const tms = createTms();
			const rule = makeRule({ name: "r1" });
			tms.ruleActivated(rule);
			expect(tms.getActiveRules().has("r1")).toBe(true);

			tms.removeRule("r1");
			expect(tms.getActiveRules().has("r1")).toBe(false);
		});
	});
});
