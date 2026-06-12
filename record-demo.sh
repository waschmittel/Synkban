#!/usr/bin/env bash
# Records a screen-recording demo of the app with Playwright and converts it
# to demo.gif (referenced from the README). Requires ffmpeg and a release
# binary (run ./build.sh first if backend/target/release/synkban is missing).
set -euo pipefail
cd "$(dirname "$0")"

command -v ffmpeg >/dev/null || { echo "error: ffmpeg is required" >&2; exit 1; }

BINARY="backend/target/release/synkban"
[ -f "$BINARY" ] || { echo "error: $BINARY missing — run ./build.sh first" >&2; exit 1; }

cd frontend
rm -rf demo-results
pnpm exec playwright test --config playwright.demo.config.ts

VIDEO=$(find demo-results -name '*.webm' | head -n 1)
[ -n "$VIDEO" ] || { echo "error: no video produced" >&2; exit 1; }

# Single-pass palette GIF: 10 fps, 960px wide, diff-based palette keeps the
# static board background crisp while text is being typed.
ffmpeg -y -loglevel error -i "$VIDEO" \
  -vf "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  ../demo.gif

echo "wrote demo.gif ($(du -h ../demo.gif | cut -f1 | tr -d ' '))"
