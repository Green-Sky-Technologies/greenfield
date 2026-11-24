#!/usr/bin/env bash
# Clean-runner check: toolchain.sh + build.sh in a fresh container from the pinned image (the one
# the CI job uses), with nothing cached. Output lands in .toolchain/dist-docker-<n>/.
# Usage: verify/docker-build.sh [run-name]   (CARGO_BUILD_JOBS, default 8, bounds memory; the
# profile fixes codegen units, so it doesn't change the output)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091 # versions.env: plain KEY=value pins
. "$HERE/versions.env"
NAME="${1:-1}"
OUT="$HERE/.toolchain/dist-docker-$NAME"
rm -rf "$OUT" && mkdir -p "$OUT"
docker run --rm --name "fork-build-$NAME" \
  -v "$HERE/build.sh:/spike/build.sh:ro" \
  -v "$HERE/toolchain.sh:/spike/toolchain.sh:ro" \
  -v "$HERE/versions.env:/spike/versions.env:ro" \
  -v "$HERE/patches:/spike/patches:ro" \
  -v "$OUT:/out" \
  -e CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-8}" \
  -e FIGCRAFT_SRC=/work/figcraft -e CRAFT_FONTS_SRC=/work/craft-fonts -e FIGCRAFT_OUT=/out/dist \
  "$BUILD_IMAGE" bash -euo pipefail -c '
    t0=$(date +%s)
    /spike/toolchain.sh
    t1=$(date +%s); echo "toolchain setup: $((t1 - t0)) s"
    /spike/build.sh
    t2=$(date +%s); echo "build.sh: $((t2 - t1)) s; total: $((t2 - t0)) s"
  ' 2>&1 | tee "$OUT/build.log"
