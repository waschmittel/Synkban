#!/usr/bin/env bash
# Generates user-guide screenshots into docs/images/ using Playwright against
# the release binary and isolated temporary directories. Requires pdftoppm and
# backend/target/release/synkban (run ./build.sh --skip-tests if missing).
set -euo pipefail
cd "$(dirname "$0")"

command -v pdftoppm >/dev/null || { echo "error: pdftoppm (poppler) is required" >&2; exit 1; }

BINARY="backend/target/release/synkban"
[ -f "$BINARY" ] || { echo "error: $BINARY missing — run ./build.sh --skip-tests first" >&2; exit 1; }

mkdir -p docs/images
cd frontend
pnpm exec playwright test --config playwright.screenshots.config.ts

cd ..
count=$(find docs/images -maxdepth 1 -name '*.png' | wc -l | tr -d ' ')
size=$(du -sh docs/images | cut -f1 | tr -d ' ')
echo "wrote $count screenshots to docs/images/ ($size total)"
