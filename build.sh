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
if [ "$DESKTOP" = true ]; then
    echo "=== Building backend (with desktop support) ==="
    cd "$ROOT/backend"
    cargo build --release --features desktop
else
    echo "=== Building backend ==="
    cd "$ROOT/backend"
    cargo build --release
fi

echo ""
echo "=== Build complete ==="
echo "Binary: backend/target/release/synkban"
echo "  Web server:   ./backend/target/release/synkban"
if [ "$DESKTOP" = true ]; then
    echo "  Desktop mode: ./backend/target/release/synkban --desktop"
fi
echo "  Open: http://localhost:8080"
