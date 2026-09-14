import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["packages/*/src/__tests__/**/*.test.ts"],
		exclude: ["packages/*/src/__tests__/**/*.performance.test.ts"],
		coverage: {
			provider: "v8",
			include: ["packages/*/src/**/*.ts"],
			exclude: ["packages/*/src/__tests__/**", "packages/*/src/testing/**", "packages/*/src/debug/**"],
			thresholds: {
				statements: 85,
				branches: 80,
				functions: 85,
				lines: 85,
			},
		},
	},
});
