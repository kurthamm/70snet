import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Only our own workspace. `vendor/` holds upstream projects with their own
    // suites (apple2ts ships jest tests), and `machines/` is an emulated CP/M
    // machine driven by Python -- neither belongs in this run.
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "vendor/**", "machines/**"],
  },
})
