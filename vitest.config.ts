import { defineConfig } from "vitest/config";

// Unit tests only. They must run without Docker, network or API keys.
// End-to-end tests against the running stack use tests/vitest.e2e.config.ts.
export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "services/*/src/**/*.test.ts",
      "tests/unit/**/*.test.ts",
    ],
    environment: "node",
  },
});
