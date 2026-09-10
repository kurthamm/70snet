#!/usr/bin/env bash
# Setup script for the S-100 CBBS emulator.
#
# This script:
# 1. Initializes the z80pack submodule if needed
# 2. Applies the phone-port patch idempotently
# 3. Builds the emulator (cpmsim)
# 4. Builds the host tools (mkdskimg, cpmsend, cpmrecv, etc.)
#
# This ensures reproducible builds from a fresh git clone.
set -euo pipefail

cd "$(dirname "$0")"

# Initialize submodule if needed
# We need to run this from the repo root, so use relative path traversal
git -C ../.. submodule update --init --recursive machines/s100-cbbs/vendor/z80pack

# Apply the phone-port patch idempotently
cd vendor/z80pack

# Check if patch is already applied using git apply --check with --reverse
if git apply --check --reverse < ../../patches/phone-port.diff > /dev/null 2>&1; then
	echo "Patch already applied, skipping."
else
	# Try to apply the patch
	if ! git apply --check < ../../patches/phone-port.diff > /dev/null 2>&1; then
		echo "ERROR: Patch does not apply and is not already applied. Cannot proceed." >&2
		exit 1
	fi
	# Apply the patch
	git apply < ../../patches/phone-port.diff
	echo "Patch applied successfully."
fi

# Build the emulator
echo "Building cpmsim emulator..."
make -j4 -C cpmsim/srcsim

# Build the host tools
echo "Building host tools (mkdskimg, cpmsend, cpmrecv)..."
make -j4 -C cpmsim/srctools

echo "Setup complete."
