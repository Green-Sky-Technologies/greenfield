#!/usr/bin/env bash
# Story 0.2 spike: build figcraft-web from source at a pinned tag, apply our patches, check the size.
#
# Usage: spikes/0.2-fork-build/build.sh [--no-patches]
#
# Needs on PATH: git, cargo + rustc (with the wasm32-unknown-unknown target), trunk, wasm-bindgen
# (same version as Cargo.lock's wasm-bindgen; trunk runs --offline so it never downloads tools)
# and wasm-opt (binaryen; must understand --enable-bulk-memory-opt, i.e. binaryen >= 120).
#
# Environment:
#   FIGCRAFT_REPO        default https://github.com/storytold/figcraft
#   FIGCRAFT_REF         default v0.18.1
#   FIGCRAFT_SHA         commit FIGCRAFT_REF must resolve to (fails otherwise; tags can move)
#   FIGCRAFT_SRC         checkout dir, default <this dir>/figcraft
#   FIGCRAFT_OUT         where the finished static site is copied, default <this dir>/dist
#   WASM_MAX_BYTES       size gate, default 25165824 (24 MiB, SPEC.md Story 0.2)
#   KEEP_WINIT_FORK=1    keep upstream's storytold/winit [patch] (see FINDINGS.md: winit is not
#                        in the wasm build graph; we drop the patch so the build only fetches
#                        figcraft, craft-libs and the egui fork)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${FIGCRAFT_REPO:-https://github.com/storytold/figcraft}"
REF="${FIGCRAFT_REF:-v0.18.1}"
SHA="${FIGCRAFT_SHA:-4acc293c2ec941ac1400837ee7e3ab51780399f8}"
SRC="${FIGCRAFT_SRC:-$HERE/figcraft}"
OUT="${FIGCRAFT_OUT:-$HERE/dist}"
MAX="${WASM_MAX_BYTES:-25165824}"
APPLY_PATCHES=1
[[ "${1:-}" == "--no-patches" ]] && APPLY_PATCHES=0

for tool in git cargo rustc trunk wasm-bindgen wasm-opt; do
  command -v "$tool" >/dev/null || { echo "error: $tool not found on PATH" >&2; exit 1; }
done
rustup target list --installed 2>/dev/null | grep -qx wasm32-unknown-unknown \
  || echo "warning: could not confirm the wasm32-unknown-unknown target via rustup" >&2

# 1. Source at the pinned commit, reset to pristine (keeps target/, which upstream git-ignores).
# Init in place rather than clone: CI restores a cached $SRC/target before this runs, so $SRC can
# exist without .git, and `git clone` refuses a non-empty directory.
if [[ ! -d "$SRC/.git" ]]; then
  git init --quiet "$SRC"
  git -C "$SRC" remote add origin "$REPO"
fi
git -C "$SRC" fetch --quiet --tags origin
git -C "$SRC" checkout --quiet --force "$REF"
git -C "$SRC" clean -fdq
got="$(git -C "$SRC" rev-parse HEAD)"
[[ "$got" == "$SHA" ]] || { echo "error: $REF is $got, expected $SHA" >&2; exit 1; }

# 2. Build-only adjustment: drop the storytold/winit patch (native-only dependency).
if [[ "${KEEP_WINIT_FORK:-0}" != "1" ]]; then
  sed -i.bak '/^winit = .*storytold\/winit/d' "$SRC/Cargo.toml"
  rm -f "$SRC/Cargo.toml.bak"
  # Re-pin winit to the same version from crates.io so nothing else in Cargo.lock moves.
  cargo update --manifest-path "$SRC/Cargo.toml" --quiet -p winit --precise 0.30.13
fi

# 3. Our patches, in order.
if [[ "$APPLY_PATCHES" == "1" ]]; then
  for p in "$HERE"/patches/*.patch; do
    [[ -f "$p" ]] || continue
    echo "applying $(basename "$p")"
    git -C "$SRC" apply --whitespace=nowarn "$p"
  done
fi

# 4. Upstream's own web recipe (packaging/web/package.sh): trunk build --release in apps/figcraft-web.
#    index.html selects the web-release profile and wasm-opt -Oz. Fixed build metadata keeps
#    the output byte-for-byte comparable between builds.
export FIGCRAFT_BUILD_SHA="$SHA"
export FIGCRAFT_BUILD_DATE="${FIGCRAFT_BUILD_DATE:-2026-01-01}"
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1767225600}"
start=$(date +%s)
# Fetch first: trunk --offline also keeps cargo off the network.
cargo fetch --manifest-path "$SRC/Cargo.toml" --locked --target wasm32-unknown-unknown
mid=$(date +%s)
(cd "$SRC/apps/figcraft-web" && trunk build --release --offline --locked)
end=$(date +%s)
echo "cargo fetch: $((mid - start)) s, trunk build: $((end - mid)) s"

SITE="$SRC/dist/web"
[[ -f "$SITE/index.html" ]] || { echo "error: $SITE/index.html missing" >&2; exit 1; }

# 5. Size gate and report.
count=0
for wasm in "$SITE"/*.wasm; do
  [[ -f "$wasm" ]] || continue
  count=$((count + 1))
  size=$(wc -c <"$wasm" | tr -d ' ')
  gz=$(gzip -9 -c "$wasm" | wc -c | tr -d ' ')
  br=""
  command -v brotli >/dev/null && br=$(brotli -q 11 -c "$wasm" | wc -c | tr -d ' ')
  if command -v sha256sum >/dev/null; then sum=$(sha256sum "$wasm" | cut -d' ' -f1)
  else sum=$(shasum -a 256 "$wasm" | cut -d' ' -f1); fi
  echo "$(basename "$wasm"): raw $size B, gzip-9 $gz B, brotli-11 ${br:-n/a} B, sha256 $sum (limit $MAX B)"
  if [[ "$size" -ge "$MAX" ]]; then
    echo "error: $(basename "$wasm") is $size bytes, not under $MAX" >&2
    exit 1
  fi
done
[[ "$count" -gt 0 ]] || { echo "error: no .wasm in $SITE" >&2; exit 1; }
echo "dist total: $(du -sk "$SITE" | cut -f1) KiB"

rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$SITE/." "$OUT/"
echo "site copied to $OUT"
