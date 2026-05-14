#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DESKTOP=false

for arg in "$@"; do
    case "$arg" in
        --desktop) DESKTOP=true ;;
        *) echo "Unknown flag: $arg"; exit 1 ;;
    esac
done

echo "=== Building frontend ==="
cd "$ROOT/frontend"
npm ci
npm run build

echo ""
echo "=== Embedding frontend into backend ==="
rm -rf "$ROOT/backend/static"
cp -r "$ROOT/frontend/dist" "$ROOT/backend/static"

echo ""
echo "=== Building backend ==="
cd "$ROOT/backend"
cargo build --release

if [ "$DESKTOP" = true ]; then
    echo ""
    echo "=== Building desktop app (Electron) ==="
    cd "$ROOT/electron"
    npm ci
    npm run dist
fi

echo ""
echo "=== Build complete ==="
echo "Binary: backend/target/release/synkban"
echo "  Web server:   ./backend/target/release/synkban"
echo "  Open: http://localhost:8080"
if [ "$DESKTOP" = true ]; then
    echo "  Desktop app:  electron/dist/"
fi
