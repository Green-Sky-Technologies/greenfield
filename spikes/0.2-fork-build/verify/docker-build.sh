#!/usr/bin/env bash
# Clean-runner check: run build.sh in a fresh rust:1.100-trixie container (the image the CI job
# uses), with nothing cached. Output lands in .toolchain/dist-docker-<n>/.
# Usage: verify/docker-build.sh [run-name]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="${1:-1}"
OUT="$HERE/.toolchain/dist-docker-$NAME"
rm -rf "$OUT" && mkdir -p "$OUT"
docker run --rm --name "fork-build-spike-$NAME" \
  -v "$HERE/build.sh:/spike/build.sh:ro" \
  -v "$HERE/patches:/spike/patches:ro" \
  -v "$OUT:/out" \
  -e FIGCRAFT_SRC=/work/figcraft -e FIGCRAFT_OUT=/out/dist \
  rust:1.100-trixie bash -euo pipefail -c '
    t0=$(date +%s)
    # trixie ships binaryen 120, which lacks --enable-bulk-memory-opt; take binaryen alone from sid.
    echo "deb http://deb.debian.org/debian sid main" > /etc/apt/sources.list.d/sid.list
    printf "Package: *\nPin: release a=unstable\nPin-Priority: 100\n" > /etc/apt/preferences.d/sid
    apt-get update -qq && apt-get install -y -qq --no-install-recommends brotli >/dev/null
    apt-get install -y -qq --no-install-recommends -t unstable binaryen >/dev/null
    rustup target add wasm32-unknown-unknown
    cargo install trunk --version 0.22.2 --locked --quiet
    cargo install wasm-bindgen-cli --version 0.2.129 --locked --quiet
    t1=$(date +%s); echo "toolchain setup: $((t1 - t0)) s"
    rustc --version; trunk --version; wasm-bindgen --version; wasm-opt --version
    /spike/build.sh
    t2=$(date +%s); echo "build.sh: $((t2 - t1)) s; total: $((t2 - t0)) s"
  ' 2>&1 | tee "$OUT/build.log"
