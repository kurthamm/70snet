#!/usr/bin/env bash
# Build everything the running site needs, from a clean checkout.
#
# One process serves the room page, the Apple II emulator and the telephone
# exchange, so all three have to be built before the service starts.
set -euo pipefail
cd "$(dirname "$0")/.."

# Dependencies are NOT installed here. A service start should not be
# resolving or downloading packages: it is slow, it needs the network, and
# this machine's supply-chain policy can legitimately reject a lockfile at
# the worst possible moment. Run "pnpm install" yourself after a pull.
if [ ! -d node_modules ]; then
  echo "node_modules is missing -- run pnpm install first" >&2
  exit 1
fi

echo "==> building the room page"
# Invoked directly rather than through pnpm: `pnpm run` performs a
# dependency-status check that re-runs install, which needs the network and
# can be refused by this machine's supply-chain policy. A service start must
# not depend on either.
VITE=$(ls -d node_modules/.pnpm/vite@*/node_modules/vite/bin/vite.js 2>/dev/null | head -1)
if [ -z "$VITE" ]; then
  echo "vite not found under node_modules/.pnpm -- run pnpm install first" >&2
  exit 1
fi
(cd apps/web && node "../../$VITE" build)

echo "==> bundling the switchboard"
# Node cannot run the sources or tsc's output directly: this workspace uses
# bundler-style module resolution, so imports carry no file extensions. A
# bundle is the correct production artifact, and it avoids depending on an
# experimental loader flag in a long-running service.
ESBUILD=$(ls -d node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild 2>/dev/null | head -1)
if [ -z "$ESBUILD" ]; then
  echo "esbuild not found under node_modules/.pnpm -- did pnpm install run?" >&2
  exit 1
fi
"$ESBUILD" apps/switchboard/src/main.ts \
  --bundle --platform=node --format=esm --target=node22 \
  --external:ws \
  --outfile=apps/switchboard/dist/server.bundle.mjs

echo "==> done"
