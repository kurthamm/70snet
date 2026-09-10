import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Only our own workspace. `vendor/` holds upstream projects with their own
    // suites (apple2ts ships jest tests), and `machines/` is an emulated CP/M
    // machine driven by Python -- neither belongs in this run.
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "vendor/**", "machines/**"],
    // `apps/web` renders the room to real DOM (room.test.ts) and needs
    // jsdom; `packages/*` stay on vitest's default plain-Node environment
    // so they keep running fast with no DOM overhead.
    environmentMatchGlobs: [["apps/web/src/**/*.test.ts", "jsdom"]],
    // The cbbs-host and switchboard suites each boot the emulated S-100
    // machine, and cpmsim reads its disk images from one shared directory.
    // Two instances at once corrupt each other's disks, so test files run one
    // at a time. The fast suites cost a second or two; the alternative is a
    // whole class of flake that only shows up under load.
    fileParallelism: false,
    // Run tests in child processes, not worker threads. The cbbs-host and
    // switchboard suites spawn an emulator, kill its process group, and hold
    // FIFO read streams across its death. Under the default threads pool the
    // reboot path hangs; the identical sequence completes in ~3s under a
    // plain node process, and under forks.
    pool: "forks",
  },
})
