import { defineConfig } from "vite"

// The room page is served BY the switchboard (apps/switchboard/src/server.ts)
// as the site root, on the same origin/port as the WebSocket exchange and
// the Apple II emulator (mounted at /apple2ts/, see server.ts). `base: "/"`
// matches that: built asset URLs are absolute from the site root, which is
// exactly where this bundle lands in production. `dev` still works
// standalone (`vite`) for iterating on markup/styles without the
// switchboard running, though the emulator iframe and exchange calls need
// the switchboard to actually answer.
export default defineConfig({
  base: "/",
  build: {
    outDir: "dist",
  },
})
