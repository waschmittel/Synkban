#!/usr/bin/env bash
# Assemble the static website into <outdir> (default: public): landing page,
# user guide, technical reference, icons, screenshots, and demo GIF.
# Zero external build dependencies. Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")/.."

out=${1:-public}
rm -rf "$out"
mkdir -p "$out/guide" "$out/technical" "$out/images"

cp site/index.html site/style.css site/site.js "$out/"
cp site/guide/index.html "$out/guide/"
cp site/technical/index.html "$out/technical/"
cp docs/images/*.png "$out/images/"
cp frontend/public/favicon.png "$out/"
cp frontend/public/icons/icon-192.png frontend/public/icons/icon-512.png "$out/"
[ -f demo.gif ] && cp demo.gif "$out/"
touch "$out/.nojekyll"

echo "site assembled -> $out"
