#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

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

echo ""
echo "=== Build complete ==="
echo "Single binary: backend/target/release/tc-backend"
echo "Run from anywhere: ./backend/target/release/tc-backend"
echo "Open: http://localhost:8080"
