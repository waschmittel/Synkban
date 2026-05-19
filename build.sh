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
pnpm install
pnpm run build

echo ""
echo "=== Embedding frontend into backend ==="
rm -rf "$ROOT/backend/static"
cp -r "$ROOT/frontend/dist" "$ROOT/backend/static"

echo ""
echo "=== Building backend ==="
cd "$ROOT/backend"
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Building macOS aarch64 binary..."
    rustup target add aarch64-apple-darwin || true
    cargo build --release --target aarch64-apple-darwin
    
    mkdir -p "$ROOT/backend/target/release"
    cp "$ROOT/backend/target/aarch64-apple-darwin/release/synkban" "$ROOT/backend/target/release/synkban"
else
    cargo build --release
fi

if [ "$DESKTOP" = true ]; then
    echo ""
    echo "=== Building desktop app (Electron) ==="
    cd "$ROOT/electron"
    pnpm install
    pnpm run dist
fi

echo ""
echo "=== Build complete ==="
echo "Binary: backend/target/release/synkban"
echo "  Web server:   ./backend/target/release/synkban"
echo "  Open: http://localhost:8080"
if [ "$DESKTOP" = true ]; then
    echo "  Desktop app:  electron/dist/"
fi
