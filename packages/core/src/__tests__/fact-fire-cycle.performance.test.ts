import { describe, expect, it } from "vitest";
import type { ProductionRule } from "../contracts.js";
import { createSession } from "../session.js";
import { formatDurations, measureMedian } from "./performance-harness.js";

describe("Fact-Triggered Fire Cycle performance", () => {
	it("100 facts × 5 rules median is <50ms", () => {
		const rules: ProductionRule[] = Array.from({ length: 5 }, (_, index) => ({
			name: `rule-${index}`,
			when: {},
			then: [{ $set: { [`result.r${index}`]: true } }],
			patterns: [{ $fact: "Order", $bind: "order" }],
		}));
		const elapsed = measureMedian(() => createFactWorkload(rules));
		expect(elapsed.results).toEqual(Array(7).fill(true));
		expect(elapsed.median).toBeLessThan(50);
		console.log(`100 facts × 5 rules median: ${formatDurations(elapsed)}`);
	});
});

function createFactWorkload(rules: readonly ProductionRule[]): () => boolean {
	const session = createSession({
		factTypes: [{ name: "Order", fields: { status: "string", amount: "number", customerId: "string" } }],
		rules,
	});
	return () => {
		for (let index = 0; index < 100; index++) {
			session.assertFact("Order", { status: "pending", amount: index, customerId: `c${index}` });
		}
		const result = session.fire();
		return result.rulesFired === 5 && session.introspect.getFactCounts().Order === 100;
	};
}
