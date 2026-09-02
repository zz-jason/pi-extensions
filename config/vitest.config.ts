import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["extensions/**/*.ts"],
      exclude: ["extensions/show-agents/index.ts"],
      reporter: ["text", "json-summary", "lcov"],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
