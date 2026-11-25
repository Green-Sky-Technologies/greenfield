# Story 0.2 spike: fork build in CI (findings)

> **History.** The editor is now built from our fork,
> [`Green-Sky-Technologies/greenfield-editor`](https://github.com/Green-Sky-Technologies/greenfield-editor):
> the patches below are commits there, and its `greenfield/build.sh`, `UPSTREAM.md` and CI replace
> this spike's scripts and `.github/workflows/figcraft-web.yml`, which were removed (Phase 3a, W1-A).
> The scripts and paths named below no longer exist in this repo.

Built `figcraft-web` from source at **v0.18.1** (`4acc293c2ec941ac1400837ee7e3ab51780399f8`) with
the pinned craft-libs and egui-fork revisions, applied one theme patch, and showed the change in
the editor embedded with `?host=parent&control&author=`. Date: 2026-11-23.

**Verdict:** the fork route works, is scripted, and is byte-for-byte reproducible from a clean
container. Two things need a decision before Epic 2:

1. Release-equivalent builds need `storytold/craft-fonts`, which this spike was not allowed to
   fetch. With those fonts the wasm is **over the 24 MiB AC**: upstream's own v0.18.1 release
   wasm is 24.32 MiB. Without them, ours is 22.6–22.7 MiB.
2. Upstream pins a `storytold/winit` fork that we also could not fetch. It is native-only, so
   this build drops it.

Details below. **Update 2026-11-24 (Stories 2.9 and 2.10):** both are resolved. The build now
uses pinned craft-fonts and the winit fork, pins every tool, and gates at 25 MiB; see
[Story 2.9](#story-29-build-inputs-and-size-budget) and [Story 2.10](#story-210-upstreamable-patches).
Sections after those describe the spike as it was.

## Files

| Path | What |
|---|---|
| `versions.env` | Every pin: build image digest, FigCraft and craft-fonts commits, trunk, wasm-bindgen, binaryen (.deb URL and sha256 per arch), the 25 MiB budget |
| `toolchain.sh` | Installs the pinned toolchain inside the build image (CI and `verify/docker-build.sh`) |
| `build.sh` | Checks tool versions against the pins, checks out FigCraft and craft-fonts at their pinned commits, applies `patches/*.patch`, `cargo fetch`, `trunk build --release --offline --locked` with `CRAFT_FONTS_DIR`, size gate (25 MiB, every build), copies the site plus licence texts to `dist/` and writes `dist/SHA256SUMS` |
| `patches/0001-theme.patch` | The theme change (below) |
| `patches/0002-inspect-revision.patch`, `patches/0003-missing-font-warning.patch` | Story 2.10 (below) |
| `verify/test-patches.sh` | Runs the patches' tests natively in the build image |
| `verify/serve.sh` | Static server on `127.0.0.1:3102`: `/editor/` = a dist, `/host.html` = iframe host |
| `verify/host.html` | Minimal same-origin host page with an iframe on `editor/index.html?host=parent&control&author=spike` |
| `verify/shoot.mjs` | Playwright (Chromium, headless, `?webgl`) runs `file.new`, `node.create {type:'frame'}`, `select.set`, `view.zoomSelection`, then takes screenshots direct and embedded, plus `ui.render` |
| `verify/docker-build.sh` | Clean-runner check: `build.sh` in a fresh `rust:1.100-trixie` container (same image as CI) |
| `out/before-*.png`, `out/after-*.png`, `out/docker-embedded.png` | Evidence. `*-result.json` holds the command results and host events |
| `../../.github/workflows/figcraft-web.yml` | CI job (not pushed, not run on GitHub) |

## Commands

Since Story 2.9 the supported route is the pinned container (`build.sh` refuses other tool
versions): `verify/docker-build.sh <name>` builds, `verify/test-patches.sh` runs the patch tests.
The spike's original local commands:

```sh
# Local toolchain, isolated from the system (nothing in ~/.rustup or ~/.cargo)
export RUSTUP_HOME=$PWD/spikes/0.2-fork-build/.toolchain/rustup CARGO_HOME=$PWD/spikes/0.2-fork-build/.toolchain/cargo
export PATH=$CARGO_HOME/bin:$PATH
sh rustup-init.sh -y --no-modify-path --profile minimal --default-toolchain 1.100.0 --target wasm32-unknown-unknown
cargo install trunk --locked                               # 0.22.2, 3 min 42 s
cargo install wasm-bindgen-cli --version 0.2.129 --locked  # must equal Cargo.lock's wasm-bindgen; 21 s
brew install binaryen                                      # wasm-opt 133 (also installed: actionlint, shellcheck)

FIGCRAFT_OUT=... spikes/0.2-fork-build/build.sh --no-patches  # upstream as-is
spikes/0.2-fork-build/build.sh                                # with patches -> spikes/0.2-fork-build/dist
spikes/0.2-fork-build/verify/serve.sh &                       # then: node spikes/0.2-fork-build/verify/shoot.mjs after
spikes/0.2-fork-build/verify/docker-build.sh 1                # clean container
```

Upstream's recipe comes from the README, `docs/releasing.md` and `packaging/web/package.sh`:

- Run `trunk build --release` in `apps/figcraft-web`.
- `index.html` selects the `web-release` profile (opt-level z, fat LTO, 1 CGU, strip, panic=abort)
  and runs `wasm-opt -Oz` with explicit feature flags (`--enable-bulk-memory-opt` and others).
- `apps/figcraft-web/.cargo/config.toml` adds `+simd128`.

There is no `rust-toolchain.toml`; the workspace sets `rust-version = "1.95"`. I used 1.100.0
because it is current stable and matches Homebrew's version. Upstream CI and release builds run
through the reusable workflows in `storytold/craft-common-actions`. I did not read those: the repo
is not on the allow-list.

## Story 2.9: build inputs and size budget

Date: 2026-11-24. Branch `story-2.9-build-budget`.

- **Fonts:** `build.sh` checks out `storytold/craft-fonts` at `37827adc41fd165f9a9234ac40f94dbad353aa69`
  (upstream's CI ref for v0.18.1) and builds with `CRAFT_FONTS_DIR` and `CRAFT_FONTS_REQUIRED=1`,
  as upstream's release builds do. `dist/` ships FigCraft's `LICENSE-MIT`, `LICENSE-APACHE`,
  `NOTICE` and `ATTRIBUTION.md`, plus every craft-fonts family's licence as `OFL-<family>.txt`
  (29 files; upstream's `copy_font_licences`).
- **winit:** upstream's `[patch.crates-io]` `storytold/winit` pin is kept (the drop and
  `KEEP_WINIT_FORK` are gone). `cargo fetch` fetches it; it is still not in the wasm graph.
- **Tools:** `versions.env` pins the image by digest (`rust:1.100-trixie@sha256:223cc32d…`), trunk
  0.22.2, wasm-bindgen 0.2.129 and binaryen 131 as Debian's `binaryen_131-2` .deb from
  snapshot.debian.org (sha256-checked per arch; it depends only on trixie's libc/libstdc++).
  `build.sh` refuses any other wasm-bindgen or wasm-opt version, so local Homebrew wasm-opt 133
  no longer builds: use `verify/docker-build.sh`.
- **Size gate:** 26,214,400 B (25 MiB raw, D26), in `build.sh`, on every build. The CI job's
  separate size step is gone: the build itself fails.
- **Fonts fit:** no `FIGCRAFT_WEB_FONTS` limit was needed (results below).

**Results** (`verify/docker-build.sh`, arm64 Docker Desktop, 14 CPUs, `CARGO_BUILD_JOBS=8`):

| Build | Raw wasm | gzip -9 | brotli -11 | wasm sha256 | `SHA256SUMS` sha256 (all 39 files) | Time |
|---|---|---|---|---|---|---|
| Clean run a, patches 0001–0003 | **25,477,866 B (24.30 MiB)** | 10,408,053 B | 7,365,932 B | `40d5d690…c92461eb8` | `83c20fb3…cb6d7d186` | 652 s (toolchain 300 s, trunk 265 s) |
| Clean run b, same | 25,477,866 B | 10,408,053 B | 7,365,932 B | `40d5d6902b2f2a367989a815c5134016b8ccb72fe79b592818759c6c92461eb8` | `83c20fb37db69deaa29d81995451efa2ffb14984d452fa9bf38a272cb6d7d186` | 676 s |
| Clean run, theme patch only | 25,477,900 B | 10,406,431 B | 7,368,787 B | `46994174…526a92d0` | | 930 s |

| GitHub CI (amd64), PR #12, two runs (push and pull_request) | 25,484,827 B (24.30 MiB) | 10,409,222 B | 7,366,744 B | `085fd954635979a36fdb14458bd22741302fed89b202f67f29c1161127b21e26` | `94dd8072…1b93afb8` | ~7–9 min job |

Runs a and b are byte-identical (`diff -r` of the two `dist/` trees is empty), and so are the
two CI runs. **arm64 and amd64 differ** by 6,961 B: the image digest is a multi-arch index, so
each host runs its own rustc/LLVM/wasm-opt binaries. Reproducibility holds per architecture; to
reproduce CI's bytes locally, run the container with `--platform linux/amd64` (not done here:
emulated, much slower). Headroom under the
gate is 736,534 B (0.70 MiB). The 24.39 MiB release-equivalent build recorded below used Homebrew
wasm-opt 133 on the Mac; the pinned binaryen 131 gives 24.30 MiB for the same inputs, which is
why tools are now pinned. An earlier attempt was OOM-killed compiling trunk with 14 parallel
jobs alongside other containers in 8 GB; `docker-build.sh` now passes `CARGO_BUILD_JOBS`
(default 8), which doesn't change output (the profile fixes codegen units).

## Story 2.10: upstreamable patches

Tests run natively in the build image (`verify/test-patches.sh`, all green):

| Patch | Change | Test |
|---|---|---|
| `0002-inspect-revision.patch` | `document.inspect` returns `revision` (bumped on every edit, undo, redo) and `history.undoDepth` | `inspect_revision_tests::revision_and_undo_depth_track_edits_undo_and_redo` (engine) |
| `0003-missing-font-warning.patch` | A command whose edit newly gives a text layer (style or styled range) a family no font provides gets `warnings: ["font family \"X\" isn't available: …"]` in its result. Only changed nodes are checked (`changed_ids`), only families new to that node warn, and nothing warns until installed fonts are indexed | `fonts::tests::an_edit_that_names_an_unavailable_family_warns_once_in_its_result` (engine; the existing `fonts::tests` suite still passes) |

**Screenshot repaint: skipped.** I wrote a patch that called `request_repaint_of` for settling
captures and a test for it. The test passed with the fix removed: `send_viewport_cmd_to`
(used for `RequestPaintWhileHidden`) already requests a repaint of that viewport, so a visible tab
is not starved. The stall SPEC risk 3 describes is the hidden tab itself: the browser runs no
animation frames, which an app-side repaint can't fix. Finding the real cause needs a browser
repro in the eframe web runner; the patch was dropped.

## Pinned revisions (Cargo.lock at v0.18.1)

| Source | Rev | Crates |
|---|---|---|
| storytold/craft-libs | `e11f9d9aebea5f6b8e74643c1ea1ed172ba5f545` | 13 (craft-ui, craft-menu, craft-settings, craft-font-*, craft-window, craft-docpath…) |
| storytold/craft-libs | `fd5e2feff6ea25bed371a99cc732b3968d621505` | craft-web-api, craft-web-host (the `window.figcraft` and `?host=parent` plumbing) |
| storytold/craft-libs | `6e03f65bf45181db77ba6229716e6624db9eb25b` | craft-update |
| storytold/egui (fork) | `6d518fc799681571963842f95b55a6b68431b15a` | 14 via `[patch.crates-io]` (egui 0.37: egui, eframe, epaint, egui-wgpu…) |
| storytold/winit (fork) | `a517b3846ee8457d84ee4975110bfda6797c44dc` | winit 0.30.13: dropped by the spike, kept since Story 2.9 |

Three craft-libs revisions in one lockfile is a drift signal in itself.

## Numbers

Local machine: Apple M4 Pro with 14 cores, macOS 26.6.1. Local toolchain: rustc/cargo 1.100.0
(rustup 1.29.3), trunk 0.22.2, wasm-bindgen 0.2.129, wasm-opt 133 (Homebrew). The Docker runs used
`rust:1.100-trixie` (arm64, Docker Desktop with 14 CPUs and 8 GB): rustc 1.100.0, trunk 0.22.2,
wasm-bindgen 0.2.129, wasm-opt 131 (Debian sid).

| Build | Wall time | Raw wasm | gzip -9 | brotli -11 | dist |
|---|---|---|---|---|---|
| Local, upstream unpatched, cold `target/` | **224 s** (trunk 177 s; crates already fetched by an earlier `cargo tree`) | 23,776,052 B (22.67 MiB) | 9,406,759 B | 6,793,489 B (6.48 MiB) | 23,412 KiB |
| Local, + theme patch, warm `target/` | 176 s (trunk 131 s; fat LTO + wasm-opt dominate) | 23,776,058 B | 9,406,761 B | 6,795,590 B | 23,412 KiB |
| Local rebuild of the same | trunk 127 s | identical sha256 `959b6af0…0fe226` | | | |
| **Docker, fully cold, run 1** | **517 s** = 228 s tools (apt, rustup target, `cargo install` trunk + wasm-bindgen) + 289 s `build.sh` (clone, fetch, trunk 231 s) | 23,672,083 B (22.58 MiB) | 9,430,753 B | 6,795,643 B | 23,324 KiB |
| Docker, fully cold, run 2 | 441 s (223 + 218) | identical sha256 `ebda4d75…e8a07b` (wasm, js, index.html all identical) | | | |
| **Upstream release asset** `figcraft-web-0.18.1.zip` (with craft-fonts) | n/a | **25,503,950 B (24.32 MiB)** | n/a | 7,375,665 B (7.03 MiB) | zip 10.0 MiB |

- **Reproducibility:** both clean-container builds are byte-identical, and so are two local
  builds. Local and container builds differ (−104 KB in the container), mostly from the wasm-opt
  version (133 vs 131). Bytes are only reproducible with a pinned image and tool versions.
  `build.sh` fixes `FIGCRAFT_BUILD_SHA`, `FIGCRAFT_BUILD_DATE` and `SOURCE_DATE_EPOCH`.
- Running `wasm-opt -Oz` again on our output saves only 24 KB, which confirms the optimiser ran.
- Without craft-fonts the module is about 1.65 MiB smaller than the release. I infer the
  difference is the embedded Inter Regular/SemiBold and Noto Sans Georgian faces. Text falls back
  to egui's bundled fonts and the UI still renders legibly (see the screenshots).
- SPEC.md's "about 18 MiB raw (4.5 MiB Brotli)" is out of date. At v0.18.1 the wasm is
  22.6–24.3 MiB raw and 6.5–7.0 MiB Brotli.
- Upstream's docs say the gate is 24 MiB, but `packaging/web/package.sh` enforces **25 MiB**
  (`26214400`, Cloudflare's per-file cap). The v0.18.1 release passes upstream's gate and fails
  ours.
- **Release-equivalent build (added 2026-11-24, after craft-fonts and the winit fork were
  approved):**

  ```sh
  CRAFT_FONTS_DIR=<craft-fonts at 37827adc> CRAFT_FONTS_REQUIRED=1 KEEP_WINIT_FORK=1 ./build.sh
  ```

  With the theme patch, the result is 25,579,895 B raw (24.39 MiB), 10,376,170 B gzip-9 and
  7,366,446 B Brotli-11 (sha256 `a832157d…f24b`). The trunk build took 206 s; 278 s wall in
  total. That is 76 KB over the upstream release, so it confirms the fonts account for the gap.
  `build.sh` fails it against the 24 MiB AC; it passes upstream's 25 MiB gate.
- On GitHub's 4-vCPU `ubuntu-24.04` runners, expect the cold job to take several times the Docker
  number (estimate, not measured). The cargo/tool cache removes the ~4 min of tool installs and
  most of the compile, but every change still re-runs the fat-LTO link.

## Theme change

`#3fd67f` does not appear anywhere at v0.18.1. The selection colour is defined in
`crates/ui-egui/src/theme.rs`:

- `BRAND` (`#02DA96`) is used for solid surfaces.
- `ACCENT` (`#00875F`) is used for thin selection outlines and white-on-green labels.
- `ACCENT_ON` is the ink colour on the brand surface.
- `set_canvas_page()` picks BRAND or ACCENT for canvas overlays by contrast with the page colour.
- `Tokens::light()` and `Tokens::dark()` derive the `accent*` tokens.

`patches/0001-theme.patch` changes 8 lines: BRAND `#FF2DAA`, ACCENT `#B5006E`, ACCENT_ON `#3D0026`,
and pinks for the light and dark `accent_hover` / `accent_text`.

**Proof** (`out/`): compare `before-embedded.png` with `after-embedded.png`. Inside the iframe host,
these turn from green to pink: the selection outline, handles, name label, size badge, Share button,
active tool, tab icon and checkbox. The host bar shows `figcraft:ready 0.18.1`, and the host
received `figcraft:ready, figcraft:dirty, figcraft:dirty`. The unframed editor (`*-editor.png`)
shows the same change, and so does the clean-container build (`docker-embedded.png`).

How the pixels were captured:

- All screenshots are **Playwright page screenshots** in headless Chromium, using SwiftShader WebGL2
  via `?webgl` because WebGPU isn't available headless.
- Capture was not flaky: `window.figcraft` was ready about 0.35–0.45 s after navigation, and every
  run succeeded.
- `figcraft.request('ui.render')` also worked, but it returns document pixels only. The before and
  after renders are byte-identical because selection chrome isn't in them, so `ui.render` can't
  prove a theme change.

The patch does not cover:

- `selected_row` / `selected_row_child` (the mint layer-row and rail highlight)
- `focus`, `success` and the avatar colour
- the loading screen in `index.html`
- the "Fig**Craft**" wordmark and the chameleon icon

A real rebrand is a much bigger patch (see Risks). Upstream's `theme.rs` tests, such as the
selected-text contrast check, were **not** run against the new colours.

## CI

`.github/workflows/figcraft-web.yml` was **not pushed and not run on GitHub**. It has:

- **Triggers:** `workflow_dispatch`, plus push/PR `paths` filters on `spikes/0.2-fork-build/**` and
  on the workflow file itself.
- **Environment:** the job runs on `ubuntu-24.04` inside `container: rust:1.100-trixie`.
- **Tools:** it installs `brotli` with apt and `binaryen` from sid (see below), runs
  `rustup target add wasm32-unknown-unknown`, and installs trunk 0.22.2 and wasm-bindgen-cli
  0.2.129 when they are not cached.
- **Cache:** `actions/cache` covers the cargo registry, git deps, the trunk/wasm-bindgen binaries
  and `target/`.
- **Build and outputs:** it runs `build.sh`, asserts each `.wasm` is under 25,165,824 B, and uploads
  `dist/` as the artifact `figcraft-web-dist`.

`actionlint` 1.7.12 and `shellcheck` pass on the workflow and scripts. `act` is not installed.
Instead, `verify/docker-build.sh` runs the same steps in the same image with nothing cached
(results above).

- **wasm-opt version:** Debian trixie ships binaryen 120, which rejects `--enable-bulk-memory-opt`.
  The first Docker run failed in wasm-opt because of it. The fix installs binaryen alone from sid
  (version 131), with an apt pin at priority 100 so nothing else is upgraded. sid moves over time,
  so a real pipeline should pin the binaryen version, either through snapshot.debian.org or the
  upstream release tarball. I did not fetch the tarball because its GitHub repo is org-owned.
- **Network:** `trunk --offline` stops trunk from downloading wasm-bindgen or wasm-opt from GitHub.
  `cargo fetch --locked --target wasm32-unknown-unknown` runs first, so a cold build still gets its
  crates.

## Deviations from "pinned revisions" (resolved by Story 2.9)

1. **`storytold/winit` is dropped.** Upstream's `[patch.crates-io]` pins a winit fork, and that repo
   is not on the spike's org allow-list. `build.sh` deletes the patch line and runs
   `cargo update -p winit --precise 0.30.13` (crates.io); only the winit lock entry changes.
   `cargo tree -p figcraft-web --target wasm32-unknown-unknown -i winit` is empty, so winit is not
   in the web build graph and the wasm is unaffected. Set `KEEP_WINIT_FORK=1` to restore upstream
   behaviour once the repo is approved.
2. **No craft-fonts.** Release web builds point `CRAFT_FONTS_DIR` at a `storytold/craft-fonts`
   checkout (ref `37827adc41fd165f9a9234ac40f94dbad353aa69` in upstream's CI) and set
   `CRAFT_FONTS_REQUIRED`. That repo is not on the allow-list, so I did not fetch it. Our build
   warns and embeds no fonts. This needs a decision, and the OFL texts must ship in the bundle if
   we embed the fonts.

## Licences

- **FigCraft:** MIT OR Apache-2.0 (`LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE`, `ATTRIBUTION.md`).
  **The ArtCraft name, wordmark and logos in `docs/brand/` are trademarks and not open source**
  (`docs/brand/LICENSE-brand.txt`). A rebrand must also replace the "FigCraft" product name, the
  in-app wordmark and the icon.
- **craft-libs** (all three revs): `MIT OR Apache-2.0`, with `LICENSE-*`, `NOTICE` and `licenses/`.
- **storytold egui fork:** `MIT OR Apache-2.0`. `epaint_default_fonts` is
  `(MIT OR Apache-2.0) AND OFL-1.1 AND Ubuntu-font-1.0`; those are the fonts our build falls back
  to.
- **craft-fonts** (if adopted): SIL OFL 1.1 for each font. The release zip ships 27 `OFL-*.txt`
  files.
- **Compatibility with this repo's AGPL-3.0-only:** MIT and Apache-2.0 code can be combined into an
  AGPL-3.0 work (one-way). OFL fonts can be bundled with software under any licence as long as the
  fonts keep the OFL. The editor bundle we distribute must carry:
  - the MIT and Apache texts;
  - FigCraft's `NOTICE` and attribution;
  - the OFL and UFL texts.

  Our patches to FigCraft files can stay MIT/Apache (simpler to upstream) or become AGPL; choose
  deliberately. This still needs review by someone qualified (SPEC risk 6, Story 8.4).

## Risks

- **Size.** There is 1.3–1.4 MiB of headroom without fonts and none with them. Upstream growth or
  our own patches will push the wasm over 24 MiB. Options:
  - adopt upstream's 25 MiB gate (Cloudflare's per-file cap; Vercel accepts larger static files);
  - limit the embedded fonts with `FIGCRAFT_WEB_FONTS`;
  - load fonts outside the wasm.
- **Build time.** About 3–4 min on 14 Apple cores and 7–9 min from scratch in a container, most of
  it the final crate's fat LTO and wasm-opt. Every patch, however small, re-runs the full LTO.
- **Fork drift.** FigCraft is alpha and moves fast: v0.18.1 is 12 days old, with 643 commands. It
  pins three craft-libs revisions plus egui and winit forks, and its CI tracks
  `craft-common-actions@main`, unpinned. Keep our patches to token values and propose a theming
  hook upstream. The colour model (BRAND/ACCENT contrast switching, token contrast tests) is
  upstream's design, so deeper patches will conflict.
- **Toolchain drift.** The wasm-bindgen CLI must match the lockfile exactly. binaryen must be newer
  than 120 to accept `--enable-bulk-memory-opt`. Different wasm-opt versions produce different
  bytes.

## What SPEC.md should change

1. **Risk 5 and Story 0.2:** replace "about 18 MiB raw (4.5 MiB Brotli)" with the measured
   22.6–22.7 MiB (no fonts) and 24.3 MiB (release, with craft-fonts), 6.5–7.0 MiB Brotli. Also
   correct the gate: upstream fails builds over 25 MiB, not 24.
2. **Story 0.2 AC "under 24 MiB raw":** as written, the upstream release fails it. Either raise it
   to 25 MiB (upstream's gate), or state that it applies to a build without craft-fonts or with a
   reduced `FIGCRAFT_WEB_FONTS`.
3. **Story 0.2 / Epic 2:** name the extra upstream inputs: `storytold/craft-fonts` (fonts, OFL) and
   the `storytold/winit` fork. Either approve them or record that the web build drops them.
4. **Story 0.2 vs a full rebrand:** "one visible theme change" is about 8 lines in
   `crates/ui-egui/src/theme.rs`. A full rebrand (wordmark, icon, `selected_row`, loading screen,
   and the trademarked product name) belongs in Epic 2 as its own story.
5. **Story 8.2:** the size-budget check should be ours (`build.sh`), not upstream's 25 MiB script.
6. **Epic 0 intro:** findings go in `docs/adr/0003-figcraft-embed.md`. This file is the raw input
   for that ADR.

## Stories 2.1 and 2.2: Greenfield theme and marks

Date: 2026-11-24. Branch `story-2.1-editor-brand`. The fork stays as patches (Epic 2's
`greenfield-editor` repo does not exist; creating it is the operator's decision).

| Path | What |
|---|---|
| `patches/0001-theme.patch` | **Removed**: the Story 0.2 hot-pink spike, replaced by 0004 |
| `patches/0004-greenfield-theme.patch` | Brand tokens (dark and light) on `Tokens`, field green on selection and focus strokes (`theme::accent()`), square corners (every literal `CornerRadius::same(N)` outside the prototype player, square avatars), no window shadow, a 4.5:1 contrast test for every text/surface pair |
| `patches/0005-greenfield-fonts.patch` | IBM Plex Sans 400/500/600 and Mono 400/500 in the chrome (`Proportional`, `medium`, `semibold`, `Monospace`, `mono-medium` families), Cormorant Garamond for the wordmark; section headers in Plex Mono 500 uppercase, buttons in Plex Sans 500, number fields in Plex Mono |
| `patches/0006-greenfield-marks.patch` | `index.html` (title, favicon, loading screen), About window and Help link, the in-UI mark painted from a 16-cell grid, FigCraft to Greenfield inside Rust string literals (generated by `tools/rebrand-strings.pl rs`) |
| `patches/0007-greenfield-marks-locales.patch` | The same rename in all 30 locale catalogs, keys and values together (`tools/rebrand-strings.pl toml`), so the i18n tests still hold |
| `overlay/` | Files copied over the fork by `build.sh`: the chrome fonts and their OFL texts (`tools/make-chrome-fonts.sh`), the Greenfield app icons and the mark bitmap (`tools/gen-marks.py`). Upstream's `assets/app-icon` is deleted first. The brand SVGs come from `apps/web/public` |
| `check-marks.sh`, `check-marks.allow`, `upstream-marks/` | The 2.2 check (below) |

**Size.** Chrome fonts are Latin subsets of Fontsource's WOFF2, converted to TTF: 253 KB for six
faces, embedded in the wasm (craft-fonts has no Plex). Wasm before: 25,477,866 B (arm64) and
25,484,827 B (CI amd64). After, arm64 in the pinned image: **25,717,749 B** (+232 KB), sha256
`64cc2cc6122d5b3c93e12891d568d2f0b3b5b6160d2ccd1ea7a882dbd09718b2`, brotli-11 7,434,290 B,
0.46 MB under the 26,214,400 B gate.

**The marks check** (`build.sh` runs it; `figcraft-web.yml` therefore does). It fails on the
display spellings FigCraft, Figcraft, ArtCraft, Artcraft, ARTCRAFT and `artcraft` (lowercase
`figcraft` is a code identifier) in: locale catalogs and non-test Rust string literals of the
patched source; every file of the built site, the wasm included (read as bytes); logo file names;
upstream's icons by sha256 and, inside the wasm, by content. The page title must be Greenfield.
Licence texts, `NOTICE` and `ATTRIBUTION.md` are copied into `dist/` after the check. Negative
controls run on every build (`check-marks.sh self-test`): title put back, ArtCraft in the page, an
upstream-named icon, FigCraft baked into the wasm, in a catalog, in a string literal.

**Decisions.**
- The About window names Greenfield only; upstream is credited in the licence texts, `NOTICE` and
  `ATTRIBUTION.md` in `dist/`. The upstream site and Discord links are gone.
- The engine's command catalog (labels and docs) keeps upstream's text in four places
  (`check-marks.allow`): the bridge pins `COMMANDS_HASH`. The UI shows Greenfield labels through
  English `[commands]` entries for `help.about` and `collab.registerLinks`.
- The default theme still follows the system (upstream behaviour). `view.themeDark` and
  `view.themeLight` persist as before.
- `ACCENT` fills stay the deep green in the dark theme (white text sits on some); strokes use
  `theme::accent()`.
- Component purple, the warning yellow and people colours are unchanged: the brand has no
  equivalent.

**Not done, shown in the screenshots.** The chrome text stays 11 px (the mockup uses 12 and 13);
tracking on labels is 1 px; the bottom toolbar, tab shapes and canvas handles keep computed or
circular radii; some avatars (top right) are still round; the loading screen's text falls back to
the system monospace (no Plex webfont is shipped); `crates/mcp` strings are untouched (not in the
web build).

**Serving our build in production** needs: `fetch-editor.mjs` and `editor-release.json` pointed at
the CI artifact (`figcraft-web-dist`, or a release of it) with its sha256 and the `/editor/`
path unchanged; `pnpm --filter @greenfield/bridge generate` is not needed (the command hash is
unchanged) but `EDITOR_RELEASE_SHA256` is; the CSP and `.figcraft-version` stamp follow the new
file; `apps/web/e2e/editor/editor.spec.ts` ignores `revision` in its snapshot (patch 0002 adds it).
