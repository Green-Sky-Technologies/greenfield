#!/usr/bin/env bash
# Serve a built site for verify/shoot.mjs: /editor/ = the dist dir, /host.html = the iframe host.
# Usage: verify/serve.sh [dist-dir]   (default: ../dist)   -> http://127.0.0.1:3102
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST="$(cd "${1:-$HERE/../dist}" && pwd)"
SITE="$HERE/../.toolchain/site"
rm -rf "$SITE" && mkdir -p "$SITE"
ln -s "$DIST" "$SITE/editor"
cp "$HERE/host.html" "$SITE/host.html"
exec python3 -m http.server 3102 --bind 127.0.0.1 --directory "$SITE"
