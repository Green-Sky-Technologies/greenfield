# Story 0.2 spike: fork build in CI (findings)

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

Details below.

## Files

| Path | What |
|---|---|
| `build.sh` | Clones/resets the pinned tag (verifies the SHA), drops the winit patch, applies `patches/*.patch`, `cargo fetch`, `trunk build --release --offline --locked`, size gate (24 MiB), prints raw/gzip/brotli/sha256, copies the site to `dist/` |
| `patches/0001-theme.patch` | The theme change (below) |
| `verify/serve.sh` | Static server on `127.0.0.1:3102`: `/editor/` = a dist, `/host.html` = iframe host |
| `verify/host.html` | Minimal same-origin host page with an iframe on `editor/index.html?host=parent&control&author=spike` |
| `verify/shoot.mjs` | Playwright (Chromium, headless, `?webgl`) runs `file.new`, `node.create {type:'frame'}`, `select.set`, `view.zoomSelection`, then takes screenshots direct and embedded, plus `ui.render` |
| `verify/docker-build.sh` | Clean-runner check: `build.sh` in a fresh `rust:1.100-trixie` container (same image as CI) |
| `out/before-*.png`, `out/after-*.png`, `out/docker-embedded.png` | Evidence. `*-result.json` holds the command results and host events |
| `../../.github/workflows/figcraft-web.yml` | CI job (not pushed, not run on GitHub) |

## Commands

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

## Pinned revisions (Cargo.lock at v0.18.1)

| Source | Rev | Crates |
|---|---|---|
| storytold/craft-libs | `e11f9d9aebea5f6b8e74643c1ea1ed172ba5f545` | 13 (craft-ui, craft-menu, craft-settings, craft-font-*, craft-window, craft-docpath…) |
| storytold/craft-libs | `fd5e2feff6ea25bed371a99cc732b3968d621505` | craft-web-api, craft-web-host (the `window.figcraft` and `?host=parent` plumbing) |
| storytold/craft-libs | `6e03f65bf45181db77ba6229716e6624db9eb25b` | craft-update |
| storytold/egui (fork) | `6d518fc799681571963842f95b55a6b68431b15a` | 14 via `[patch.crates-io]` (egui 0.37: egui, eframe, epaint, egui-wgpu…) |
| storytold/winit (fork) | `a517b3846ee8457d84ee4975110bfda6797c44dc` | winit 0.30.13: **not fetched, see Deviations** |

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

## Deviations from "pinned revisions"

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
