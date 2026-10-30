import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/ui",
  timeout: 120_000,
  use: { baseURL: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
});
