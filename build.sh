#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DESKTOP=false
SKIP_TESTS=false

usage() {
    cat <<'USAGE'
Usage: ./build.sh [options]

Builds the frontend, embeds it into the Rust backend, builds the backend,
and runs the Playwright e2e tests.

Options:
  --desktop      Also package the Electron desktop app into electron/dist/
  --skip-tests   Skip the Playwright e2e tests
  -h, --help     Show this help and exit
USAGE
}

for arg in "$@"; do
    case "$arg" in
        --desktop) DESKTOP=true ;;
        --skip-tests) SKIP_TESTS=true ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown flag: $arg"; echo; usage; exit 1 ;;
    esac
done

# Version string: the exact tag at HEAD when releasing, else a dated snapshot.
# Overridable via the SYNKBAN_VERSION env var (CI passes the pushed tag here).
VERSION="${SYNKBAN_VERSION:-$(git -C "$ROOT" describe --tags --exact-match HEAD 2>/dev/null || echo "snap-$(date -u +%Y-%m-%d)")}"
export SYNKBAN_VERSION="$VERSION"
echo "=== Synkban version: $VERSION ==="

echo "=== Building frontend ==="
cd "$ROOT/frontend"
pnpm install
pnpm run build

echo ""
echo "=== Embedding frontend into backend ==="
rm -rf "$ROOT/backend/static"
cp -r "$ROOT/frontend/dist" "$ROOT/backend/static"

# Stamp the embedded web manifest with the build version (portable in-place sed).
manifest="$ROOT/backend/static/manifest.webmanifest"
if [ -f "$manifest" ]; then
    tmp="$(mktemp)"
    sed "s/__APP_VERSION__/$VERSION/g" "$manifest" > "$tmp" && mv "$tmp" "$manifest"
fi

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

if [ "$SKIP_TESTS" = true ]; then
    echo ""
    echo "=== Skipping e2e tests (--skip-tests) ==="
else
    echo ""
    echo "=== Running e2e tests ==="
    cd "$ROOT/frontend"
    pnpm exec playwright install chromium
    pnpm run test:e2e
fi

if [ "$DESKTOP" = true ]; then
    echo ""
    echo "=== Building desktop app (Electron) ==="
    cd "$ROOT/electron"
    COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    printf '{ "version": "%s", "build": "%s", "commit": "%s" }\n' "$VERSION" "$(date -u '+%Y-%m-%d %H:%M UTC')" "$COMMIT" > app-version.json
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
