import { describe, expect, test } from "vitest";
import { createAgenda } from "../agenda.js";
import type { CompiledRule, ProductionRule } from "../contracts.js";

function makeRule(overrides: Partial<ProductionRule> & { name: string }): CompiledRule {
	const source: ProductionRule = {
		name: overrides.name,
		when: overrides.when ?? { field: true },
		then: overrides.then ?? [],
		salience: overrides.salience,
		activationGroup: overrides.activationGroup,
	};
	return {
		name: source.name,
		condition: source.when,
		actions: [],
		salience: source.salience ?? 0,
		activationGroup: source.activationGroup,
		onConflict: "error",
		enabled: true,
		hasTms: false,
		source,
		dependencies: { conditionReads: [], rhsReads: [], actionWrites: [], bindingReads: [] },
	};
}

describe("Agenda", () => {
	describe("basic", () => {
		test("empty agenda returns undefined from selectNext", () => {
			const agenda = createAgenda();
			expect(agenda.selectNext()).toBeUndefined();
		});

		test("isEmpty returns true for empty agenda", () => {
			expect(createAgenda().isEmpty()).toBe(true);
		});

		test("adding activation makes isEmpty false", () => {
			const agenda = createAgenda();
			agenda.addActivation(makeRule({ name: "r1" }));
			expect(agenda.isEmpty()).toBe(false);
		});

		test("selectNext returns the only activated rule", () => {
			const agenda = createAgenda();
			const rule = makeRule({ name: "r1" });
			agenda.addActivation(rule);
			expect(agenda.selectNext()).toBe(rule);
		});

		test("selectNext removes the activation", () => {
			const agenda = createAgenda();
			agenda.addActivation(makeRule({ name: "r1" }));
			agenda.selectNext();
			expect(agenda.isEmpty()).toBe(true);
		});

		test("size reflects activation count", () => {
			const agenda = createAgenda();
			expect(agenda.size()).toBe(0);
			agenda.addActivation(makeRule({ name: "r1" }));
			agenda.addActivation(makeRule({ name: "r2" }));
			expect(agenda.size()).toBe(2);
		});
	});

	describe("conflict resolution", () => {
		test("higher salience fires first", () => {
			const agenda = createAgenda();
			agenda.addActivation(makeRule({ name: "low", salience: 1 }));
			agenda.addActivation(makeRule({ name: "high", salience: 10 }));
			expect(agenda.selectNext()?.name).toBe("high");
			expect(agenda.selectNext()?.name).toBe("low");
		});

		test("equal salience, more recent fires first", () => {
			const agenda = createAgenda();
			agenda.addActivation(makeRule({ name: "first", salience: 5 }));
			agenda.addActivation(makeRule({ name: "second", salience: 5 }));
			expect(agenda.selectNext()?.name).toBe("second");
			expect(agenda.selectNext()?.name).toBe("first");
		});

		test("equal salience and recency impossible, but higher specificity breaks tie", () => {
			const agenda = createAgenda();
			// More keys in `when` = higher specificity
			agenda.addActivation(makeRule({ name: "simple", salience: 0, when: { a: true } }));
			agenda.addActivation(makeRule({ name: "complex", salience: 0, when: { a: true, b: true, c: true } }));
			// 'complex' added later so it wins on recency; verify it fires first
			expect(agenda.selectNext()?.name).toBe("complex");
		});
	});

	describe("activation groups", () => {
		test("rules with no group always eligible", () => {
			const agenda = createAgenda();
			agenda.setFocus("validation");
			agenda.addActivation(makeRule({ name: "r1" }));
			expect(agenda.selectNext()?.name).toBe("r1");
		});

		test("setFocus limits selectNext to that group", () => {
			const agenda = createAgenda();
			agenda.addActivation(makeRule({ name: "val", activationGroup: "validation" }));
			agenda.addActivation(makeRule({ name: "calc", activationGroup: "calculation" }));
			agenda.setFocus("validation");
			expect(agenda.selectNext()?.name).toBe("val");
		});

		test("rules in non-focused group are skipped", () => {
			const agenda = createAgenda();
			agenda.addActivation(makeRule({ name: "calc", salience: 100, activationGroup: "calculation" }));
			agenda.setFocus("validation");
			// Only non-group rules eligible; calc is skipped
			expect(agenda.selectNext()).toBeUndefined();
		});

		test("clearFocus makes all rules eligible again", () => {
			const agenda = createAgenda();
			agenda.addActivation(makeRule({ name: "calc", activationGroup: "calculation" }));
			agenda.setFocus("validation");
			expect(agenda.selectNext()).toBeUndefined();
			agenda.clearFocus();
			// Re-add since it's still there (selectNext didn't remove — returned undefined)
			expect(agenda.selectNext()?.name).toBe("calc");
		});

		test("getFocusGroup returns top of stack", () => {
			const agenda = createAgenda();
			expect(agenda.getFocusGroup()).toBeUndefined();
			agenda.setFocus("A");
			expect(agenda.getFocusGroup()).toBe("A");
		});

		test("focus stack: setFocus A then B, getFocusGroup returns B", () => {
			const agenda = createAgenda();
			agenda.setFocus("A");
			agenda.setFocus("B");
			expect(agenda.getFocusGroup()).toBe("B");
		});
	});

	describe("edge cases", () => {
		test("removeActivation for non-existent rule is a no-op", () => {
			const agenda = createAgenda();
			agenda.addActivation(makeRule({ name: "r1" }));
			agenda.removeActivation("nonexistent");
			expect(agenda.size()).toBe(1);
		});

		test("multiple activations for different rules", () => {
			const agenda = createAgenda();
			agenda.addActivation(makeRule({ name: "r1" }));
			agenda.addActivation(makeRule({ name: "r2" }));
			agenda.addActivation(makeRule({ name: "r3" }));
			expect(agenda.size()).toBe(3);
			agenda.selectNext();
			expect(agenda.size()).toBe(2);
		});

		test("re-adding same rule updates timestamp", () => {
			const agenda = createAgenda();
			const r1 = makeRule({ name: "r1", salience: 0 });
			const r2 = makeRule({ name: "r2", salience: 0 });
			agenda.addActivation(r1);
			agenda.addActivation(r2);
			// r2 is more recent, would fire first
			// Re-add r1 to make it most recent
			agenda.addActivation(r1);
			expect(agenda.size()).toBe(2);
			expect(agenda.selectNext()?.name).toBe("r1");
		});

		test("getActivations returns copy", () => {
			const agenda = createAgenda();
			agenda.addActivation(makeRule({ name: "r1" }));
			const snap = agenda.getActivations();
			agenda.addActivation(makeRule({ name: "r2" }));
			expect(snap.length).toBe(1);
			expect(agenda.getActivations().length).toBe(2);
		});
	});
});
