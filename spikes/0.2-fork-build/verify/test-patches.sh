#!/usr/bin/env bash
# Run the tests our patches add (Stories 2.1, 2.2, 2.10), natively, in the pinned build image:
# pristine FigCraft at the pinned commit + patches/*.patch + overlay/, then each patch's tests. A named volume keeps
# the cargo cache between runs. Usage: verify/test-patches.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091 # versions.env: plain KEY=value pins
. "$HERE/versions.env"
docker run --rm --name fork-patch-tests \
  -v "$HERE/versions.env:/spike/versions.env:ro" \
  -v "$HERE/patches:/spike/patches:ro" \
  -v "$HERE/overlay:/spike/overlay:ro" \
  -v greenfield-fork-cargo:/usr/local/cargo/registry \
  -v greenfield-fork-target:/work/target \
  -e CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-8}" -e CARGO_TARGET_DIR=/work/target \
  "$BUILD_IMAGE" bash -euo pipefail -c '
    . /spike/versions.env
    git init -q /work/figcraft && cd /work/figcraft
    git fetch -q --depth 1 "$FIGCRAFT_REPO" "$FIGCRAFT_SHA" && git checkout -q FETCH_HEAD
    for p in /spike/patches/*.patch; do echo "applying $(basename "$p")"; git apply --whitespace=nowarn "$p"; done
    rm -rf assets/app-icon && cp -R /spike/overlay/. .
    # 0002: revision and undo depth in document.inspect
    cargo test -q -p figcraft-engine --lib inspect_revision_tests
    # 0003: missing-font warning in command results (plus the existing missing-font suite)
    cargo test -q -p figcraft-engine --lib fonts::tests
    # 0004: Greenfield tokens (4.5:1 text contrast in both themes), startup theme, persistence
    cargo test -q -p figcraft-ui-egui --lib theme
    # 0005/0006/0007: fonts draw, catalogs match the code (renamed keys), menus and dialogs read
    cargo test -q -p figcraft-ui-egui --lib i18n
    cargo test -q -p figcraft-ui-egui --lib menu_contrast_tests
    # 0008: canvas mode (draws only the canvas, requests go to the host, ?canvas)
    cargo test -q -p figcraft-ui-egui --lib canvas_mode_tests
    cargo test -q -p figcraft-web --bin figcraft-web query_tests
  '
