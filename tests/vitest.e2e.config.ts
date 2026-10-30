import { defineConfig } from "vitest/config";

// End-to-end tests against the RUNNING stack (npm run stack:up && npm run seed && npm start).
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.e2e.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
