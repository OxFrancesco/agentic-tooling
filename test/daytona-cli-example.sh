#!/usr/bin/env bash
# Example smoke run for the Daytona CLI.
# Requires: DAYTONA_API_KEY set, bun installed.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "hello from local file" > test/payload.txt

bun run scripts/daytona-cli.ts -- \
  --push test/payload.txt \
  --cmd "wc -c ${REMOTE_DIR:-/tmp/daytona-cli}/payload.txt" \
  --pull ${REMOTE_DIR:-/tmp/daytona-cli}/payload.txt:test/payload.out

echo "Pulled file contents:"
cat test/payload.out

