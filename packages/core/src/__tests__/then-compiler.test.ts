import { describe, expect, it } from "vitest";
import type { ThenStage } from "../contracts.js";
import { compileThenActions } from "../then-compiler.js";

describe("compileThenActions", () => {
	it("compiles $set stage with literal value", () => {
		const stages: readonly ThenStage[] = [{ $set: { score: 100 } }];
		const result = compileThenActions(stages);
		expect(result).toHaveLength(1);
		expect(result[0].operator).toBe("$set");
		expect(result[0].entries.get("score")).toMatchObject({ expression: { dependencies: [] } });
	});

	it("compiles $set stage with expression value", () => {
		const stages: readonly ThenStage[] = [{ $set: { total: { $sum: ["$a", "$b"] } } }];
		const result = compileThenActions(stages);
		expect(result[0].entries.get("total")).toMatchObject({
			expression: {
				dependencies: [
					{ source: "root", path: "a" },
					{ source: "root", path: "b" },
				],
			},
		});
	});

	it("compiles $unset stage", () => {
		const stages: readonly ThenStage[] = [{ $unset: { temp: "" } }];
		const result = compileThenActions(stages);
		expect(result[0].operator).toBe("$unset");
		expect(result[0].entries.has("temp")).toBe(true);
	});

	it("compiles $push stage with literal", () => {
		const stages: readonly ThenStage[] = [{ $push: { items: "new-item" } }];
		const result = compileThenActions(stages);
		expect(result[0].operator).toBe("$push");
		expect(result[0].entries.get("items")).toMatchObject({ expression: { dependencies: [] } });
	});

	it("compiles $pull stage with match condition", () => {
		const stages: readonly ThenStage[] = [{ $pull: { items: { status: "removed" } } }];
		const result = compileThenActions(stages);
		expect(result[0].operator).toBe("$pull");
		expect(result[0].entries.has("items")).toBe(true);
	});

	it("compiles $inc stage", () => {
		const stages: readonly ThenStage[] = [{ $inc: { counter: 1 } }];
		const result = compileThenActions(stages);
		expect(result[0].operator).toBe("$inc");
		expect(result[0].entries.get("counter")).toMatchObject({ expression: { dependencies: [] } });
	});

	it("compiles $merge stage with object value", () => {
		const stages: readonly ThenStage[] = [{ $merge: { config: { theme: "dark" } } }];
		const result = compileThenActions(stages);
		expect(result[0].operator).toBe("$merge");
		expect(result[0].entries.get("config")).toMatchObject({ expression: { dependencies: [] } });
	});

	it("compiles $focus stage", () => {
		const stages: readonly ThenStage[] = [{ $focus: { group: "validation" } }];
		const result = compileThenActions(stages);
		expect(result[0].operator).toBe("$focus");
		expect(result[0].entries.get("group")).toBe("validation");
	});

	it("throws on path with __proto__", () => {
		const stages: readonly ThenStage[] = [{ $set: { "a.__proto__.b": "x" } }];
		expect(() => compileThenActions(stages)).toThrow("dangerous segment");
	});

	it("throws on empty path", () => {
		const stages: readonly ThenStage[] = [{ $set: { "": "x" } }];
		expect(() => compileThenActions(stages)).toThrow("non-empty string");
	});
});
