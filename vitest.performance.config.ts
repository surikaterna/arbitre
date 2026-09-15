import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["packages/*/src/__tests__/**/*.performance.test.ts"],
	},
});
