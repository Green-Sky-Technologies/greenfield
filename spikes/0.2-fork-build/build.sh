#!/usr/bin/env bash
# Build figcraft-web from source at a pinned tag with pinned fonts and tools, apply our patches,
# and enforce the size budget. Every build runs the size gate; there is no way to skip it.
#
# Usage: spikes/0.2-fork-build/build.sh [--no-patches]
#
# Pins live in versions.env. Needs on PATH: git, cargo + rustc (with the wasm32-unknown-unknown
# target), trunk, wasm-bindgen and wasm-opt at the pinned versions (toolchain.sh installs them in
# the build image; verify/docker-build.sh runs everything in that image).
#
# The size budget (WASM_MAX_BYTES, 25 MiB raw, SPEC.md D26) is in versions.env.
#
# Environment:
#   FIGCRAFT_SRC         figcraft checkout dir, default <this dir>/figcraft
#   CRAFT_FONTS_SRC      craft-fonts checkout dir, default <this dir>/craft-fonts
#   FIGCRAFT_OUT         where the finished static site is copied, default <this dir>/dist
#   FIGCRAFT_WEB_FONTS   extra manifest families to embed (upstream's build.rs input; unset by default)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091 # versions.env: plain KEY=value pins
. "$HERE/versions.env"
SRC="${FIGCRAFT_SRC:-$HERE/figcraft}"
FONTS="${CRAFT_FONTS_SRC:-$HERE/craft-fonts}"
OUT="${FIGCRAFT_OUT:-$HERE/dist}"
APPLY_PATCHES=1
[[ "${1:-}" == "--no-patches" ]] && APPLY_PATCHES=0

for tool in git cargo rustc trunk wasm-bindgen wasm-opt; do
  command -v "$tool" >/dev/null || { echo "error: $tool not found on PATH" >&2; exit 1; }
done
# Different tool versions give different bytes: refuse anything but the pins.
wasm-bindgen --version | grep -qx "wasm-bindgen $WASM_BINDGEN_VERSION" \
  || { echo "error: need wasm-bindgen $WASM_BINDGEN_VERSION, have '$(wasm-bindgen --version)'" >&2; exit 1; }
wasm-opt --version | grep -Eq "^wasm-opt version $BINARYEN_VERSION( |$)" \
  || { echo "error: need wasm-opt $BINARYEN_VERSION, have '$(wasm-opt --version)'" >&2; exit 1; }

# Check out $2 (a full commit sha) from $3 into $1, pristine. Init in place rather than clone: CI
# restores a cached target/ before this runs, so the dir can exist without .git.
checkout_pinned() {
  local dir="$1" sha="$2" repo="$3"
  if [[ ! -d "$dir/.git" ]]; then
    git init --quiet "$dir"
    git -C "$dir" remote add origin "$repo"
  fi
  git -C "$dir" cat-file -e "$sha^{commit}" 2>/dev/null || git -C "$dir" fetch --quiet --depth 1 origin "$sha"
  git -C "$dir" checkout --quiet --force "$sha"
  git -C "$dir" clean -fdq
  [[ "$(git -C "$dir" rev-parse HEAD)" == "$sha" ]] || { echo "error: $dir is not at $sha" >&2; exit 1; }
}

# 1. Sources at pinned commits (FIGCRAFT_SHA is v0.18.1; tags can move, shas can't).
checkout_pinned "$SRC" "$FIGCRAFT_SHA" "$FIGCRAFT_REPO"
checkout_pinned "$FONTS" "$CRAFT_FONTS_SHA" "$CRAFT_FONTS_REPO"

# 2. Our patches, in order.
if [[ "$APPLY_PATCHES" == "1" ]]; then
  for p in "$HERE"/patches/*.patch; do
    [[ -f "$p" ]] || continue
    echo "applying $(basename "$p")"
    git -C "$SRC" apply --whitespace=nowarn "$p"
  done
fi

# 3. Upstream's web recipe (packaging/web/package.sh): trunk build --release in apps/figcraft-web,
#    with craft-fonts embedded as in upstream's release builds. index.html selects the web-release
#    profile and wasm-opt -Oz. Fixed build metadata keeps the output byte-for-byte reproducible.
export CRAFT_FONTS_DIR="$FONTS" CRAFT_FONTS_REQUIRED=1
export FIGCRAFT_BUILD_SHA="$FIGCRAFT_SHA"
export FIGCRAFT_BUILD_DATE="${FIGCRAFT_BUILD_DATE:-2026-01-01}"
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1767225600}"
start=$(date +%s)
# Fetch first (this also fetches the pinned storytold/egui and storytold/winit forks): trunk
# --offline keeps cargo off the network.
cargo fetch --manifest-path "$SRC/Cargo.toml" --locked --target wasm32-unknown-unknown
mid=$(date +%s)
(cd "$SRC/apps/figcraft-web" && trunk build --release --offline --locked)
end=$(date +%s)
echo "cargo fetch: $((mid - start)) s, trunk build: $((end - mid)) s"

SITE="$SRC/dist/web"
[[ -f "$SITE/index.html" ]] || { echo "error: $SITE/index.html missing" >&2; exit 1; }

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# 4. Size gate (every build) and report.
count=0
for wasm in "$SITE"/*.wasm; do
  [[ -f "$wasm" ]] || continue
  count=$((count + 1))
  size=$(wc -c <"$wasm" | tr -d ' ')
  gz=$(gzip -9 -n -c "$wasm" | wc -c | tr -d ' ')
  br=""
  command -v brotli >/dev/null && br=$(brotli -q 11 -c "$wasm" | wc -c | tr -d ' ')
  echo "$(basename "$wasm"): raw $size B, gzip-9 $gz B, brotli-11 ${br:-n/a} B, sha256 $(sha256 "$wasm") (limit $WASM_MAX_BYTES B)"
  if [[ "$size" -gt "$WASM_MAX_BYTES" ]]; then
    echo "error: $(basename "$wasm") is $size bytes, over the $WASM_MAX_BYTES-byte budget (SPEC.md D26)" >&2
    exit 1
  fi
done
[[ "$count" -gt 0 ]] || { echo "error: no .wasm in $SITE" >&2; exit 1; }

# 5. Site plus licences: FigCraft's MIT/Apache texts and NOTICE, and every craft-fonts family's
#    OFL text as OFL-<family-dir>.txt (upstream's copy_font_licences in packaging/env.sh).
rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$SITE/." "$OUT/"
for f in LICENSE-MIT LICENSE-APACHE NOTICE ATTRIBUTION.md; do cp "$SRC/$f" "$OUT/"; done
for lic in "$FONTS"/fonts/*/OFL.txt; do
  cp "$lic" "$OUT/OFL-$(basename "$(dirname "$lic")").txt"
done
sums="$(cd "$OUT" && find . -type f | LC_ALL=C sort | while read -r f; do echo "$(sha256 "$f")  $f"; done)"
echo "$sums" >"$OUT/SHA256SUMS"
echo "dist: $(find "$OUT" -type f | wc -l | tr -d ' ') files, $(du -sk "$OUT" | cut -f1) KiB, SHA256SUMS sha256 $(sha256 "$OUT/SHA256SUMS")"
echo "site copied to $OUT"
