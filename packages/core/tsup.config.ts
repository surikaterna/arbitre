import { defineConfig } from "tsup";
import { baseConfig } from "../../tsup.config.base";

export default defineConfig({
	...baseConfig,
	entry: ["src/index.ts", "src/testing/index.ts", "src/debug/index.ts"],
	external: ["kuery", "kuery/compile", "kuery/expression"],
});
