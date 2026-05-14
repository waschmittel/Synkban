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

    # On macOS, create a proper .app bundle
    if [ "$(uname)" = "Darwin" ]; then
        echo ""
        echo "=== Creating macOS app bundle ==="
        APP="$ROOT/backend/target/release/Synkban.app"
        rm -rf "$APP"
        mkdir -p "$APP/Contents/MacOS"
        mkdir -p "$APP/Contents/Resources"
        cp "$ROOT/backend/target/release/synkban" "$APP/Contents/MacOS/synkban-bin"
        cp "$ROOT/backend/Info.plist" "$APP/Contents/Info.plist"
        cp "$ROOT/backend/icons/icon.icns" "$APP/Contents/Resources/icon.icns"
        # Launcher script that always passes --desktop
        cat > "$APP/Contents/MacOS/synkban" << 'LAUNCHER'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/synkban-bin" --desktop "$@"
LAUNCHER
        chmod +x "$APP/Contents/MacOS/synkban"
        echo "  Created: $APP"
    fi
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
    if [ "$(uname)" = "Darwin" ]; then
        echo "  macOS app:    open backend/target/release/Synkban.app"
    fi
fi
echo "  Open: http://localhost:8080"
