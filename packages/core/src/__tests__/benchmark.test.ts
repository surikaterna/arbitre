import { describe, expect, it } from "vitest";
import type { ProductionRule } from "../contracts.js";
import { createSession } from "../session.js";

// ---------------------------------------------------------------------------
// Performance benchmarks (ADR §18)
// Median sampling keeps the fixed ceilings meaningful without failing on a single scheduler pause.
// ---------------------------------------------------------------------------

describe("Benchmarks", () => {
	it("50-rule form median fire is < 50ms", () => {
		const rules: ProductionRule[] = Array.from({ length: 50 }, (_, i) => ({
			name: `field-${i}-visibility`,
			when: { [`field${i}`]: { $exists: true } },
			then: [{ $set: { [`$ui.field${i}.visible`]: true } }],
		}));

		const initialState: Record<string, unknown> = {};
		for (let i = 0; i < 50; i++) {
			initialState[`field${i}`] = `value${i}`;
		}

		const elapsed = medianDuration(() => {
			const session = createSession({ rules, initialState });
			return () => session.fire().rulesFired;
		}, 50);
		expect(elapsed.median).toBeLessThan(50);
		console.log(`50-rule fire median: ${formatDurations(elapsed)}`);
	});

	it("200-rule contributions median fire is < 100ms", () => {
		const rules: ProductionRule[] = Array.from({ length: 200 }, (_, i) => ({
			name: `contribution-${i}`,
			when: { context: "active" },
			then: [{ $set: { [`$contributions.action${i}.visible`]: true } }],
		}));

		const elapsed = medianDuration(() => {
			const session = createSession({
				rules,
				initialState: { context: "active" },
				limits: { maxCycles: 500, maxRuleFirings: 5000 },
			});
			return () => session.fire().rulesFired;
		}, 200);
		expect(elapsed.median).toBeLessThan(100);
		console.log(`200-rule fire median: ${formatDurations(elapsed)}`);
	});

	it("1000 field updates median is < 500ms", () => {
		const elapsed = medianDuration(createUpdateWorkload, 1000);
		expect(elapsed.median).toBeLessThan(500);
		console.log(`1000 updates median: ${formatDurations(elapsed)}`);
	});
});

interface TimingResult {
	readonly median: number;
	readonly samples: readonly number[];
}

function medianDuration(createWorkload: () => () => number, expectedResult: number): TimingResult {
	for (let index = 0; index < 2; index++) expect(createWorkload()()).toBe(expectedResult);
	const samples: number[] = [];
	for (let index = 0; index < 5; index++) {
		const workload = createWorkload();
		const start = performance.now();
		expect(workload()).toBe(expectedResult);
		samples.push(performance.now() - start);
	}
	const ordered = [...samples].sort((left, right) => left - right);
	return { median: ordered[Math.floor(ordered.length / 2)]!, samples };
}

function createUpdateWorkload(): () => number {
	const session = createSession({
		initialState: { counter: 0 },
		rules: [
			{
				name: "counter-display",
				when: { counter: { $exists: true } },
				then: [{ $set: { "$ui.counterDisplay.value": "$counter" } }],
			},
		],
	});
	session.fire();
	return () => {
		for (let index = 0; index < 1000; index++) session.update("counter", index);
		return 1000;
	};
}

function formatDurations(result: TimingResult): string {
	return `${result.median.toFixed(2)}ms [${result.samples.map((sample) => sample.toFixed(2)).join(", ")}]`;
}
