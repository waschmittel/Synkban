#!/usr/bin/env bash
# Preview the website locally: build into <outdir> (default: public) and serve
# at http://127.0.0.1:<port> (default 8000). Offers to install fswatch for live
# rebuilds when running interactively.
set -euo pipefail
cd "$(dirname "$0")/.."

out=${1:-public}
port=${2:-8000}

ask() {
  local q=$1; shift
  [[ -t 0 ]] || return 1
  read -r -p "$q [y/N] " a
  [[ $a == [yY]* ]] && "$@"
}

command -v fswatch >/dev/null || ask "fswatch not found (rebuild on change). Install with brew?" brew install fswatch || true

site/build.sh "$out"
if command -v fswatch >/dev/null; then
  (fswatch -o -l 1 site docs/images frontend/public/icons |
    while read -r _; do site/build.sh "$out" || true; done) &
  trap 'kill 0' EXIT
fi

echo "Serving $out at http://127.0.0.1:$port"
python3 -I -m http.server "$port" --directory "$out" --bind 127.0.0.1
