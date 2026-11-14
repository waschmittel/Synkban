#!/usr/bin/env bash
# Build (without e2e tests), start Synkban and open it in the default browser.
# Honours PORT (default 8080); extra args are passed to the binary.
set -euo pipefail
cd "$(dirname "$0")"

./build.sh --skip-tests

PORT="${PORT:-8080}"
export PORT
URL="http://localhost:$PORT"

./backend/target/release/synkban "$@" &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' EXIT INT TERM

# Wait until the server answers (max ~10 s), then open the browser.
for _ in $(seq 1 100); do
  curl -fs "$URL/api/boards" >/dev/null 2>&1 && break
  kill -0 "$PID" 2>/dev/null || exit 1
  sleep 0.1
done

case "$(uname -s)" in
  Darwin) open "$URL" ;;
  MINGW*|MSYS*|CYGWIN*) start "$URL" ;;
  *) xdg-open "$URL" >/dev/null 2>&1 || echo "Open $URL" ;;
esac

wait "$PID"
