# Story 0.4: real-browser checks (findings)

Spike code (throwaway). Editor: upstream `figcraft-web` **v0.18.1** release
(`figcraft-web-f987f34d74d47a59_bg.wasm`, 25,503,950 bytes raw), served standalone by
`serve.mjs` on port 3104 (`application/wasm`) and embedded in host mode by `pages/host.html`
(`/editor/index.html?host=parent&control&author=spike`). Source read: storytold/figcraft tag
v0.18.1 (`4acc293c`).

## Machine and browsers

| | |
|---|---|
| CPU | Apple M4 Pro |
| RAM | 24 GiB (`hw.memsize` 25769803776) |
| OS | macOS 26.6.1 (25G76) |
| Node / Playwright | 22.14.0 / 1.64.1 (`apps/web`'s `@playwright/test`) |
| Chromium (Playwright) | 156.0.8078.4; headless = `chromium-headless-shell` |
| Chrome (`channel: 'chrome'`) | 158.0.8127.37 stable; headless = new headless |
| Firefox (Playwright) | 157.0 |
| WebKit (Playwright) | 27.2 |
| Viewport | 1440×900 CSS px. Headed Chromium/Chrome/Firefox draw at DPR 2 on this Mac (120 Hz in Chrome); headless and WebKit at DPR 1, 60 Hz |

Backend the editor picked (its `figcraft-web: wgpu backend …` console line): **WebGPU** in Chrome
(headless and headed), Chromium headed, Firefox headed and WebKit (both); **WebGL2** in Chromium
headless-shell and Firefox headless.

## Repro

```sh
pnpm install
cd spikes/0.4-browser
curl -LO https://github.com/storytold/figcraft/releases/download/v0.18.1/figcraft-web-0.18.1.zip
unzip figcraft-web-0.18.1.zip -d editor                                      # gitignored
git clone --depth 1 --branch v0.18.1 https://github.com/storytold/figcraft figcraft   # gitignored
(cd ../../apps/web && npx playwright install chromium firefox webkit)
node serve.mjs            # optional: every script starts the server itself when port 3104 is free

node screenshot.mjs --tries 10 --scenarios nodoc,small,example,large,background        # (a) 8 configs
node screenshot.mjs --tries 10 --browsers webkit-headless,webkit-headed --scenarios example --tag example
node screenshot.mjs --tries 20 --browsers firefox-headless --scenarios nodoc,small,large \
     --methods screenshot,screenshotNudge --tag nudge --large 2000                       # (a) hang + fix
node probe-realhidden.mjs tab                     # (a) real background tab: Chrome + raw CDP, no Playwright
node probe-realhidden.mjs minimize
node probe-hidden.mjs chrome-headed tab           # (a) the same under Playwright (stays "visible")
node measure-change.mjs chrome-headed --reps 10 --only cost,correctness   # (b) also firefox-headed, webkit-headed
node measure-change.mjs chrome-headed --only frames --tag frames          # (b) frame times while polling
node large.mjs gen --sizes 10000,30000            # (c) writes gen/gen-<n>.figcraft
node large.mjs run chrome-headed                  # (c) also firefox-headed, webkit-headed, chromium-headless
node summarize.mjs compact                        # (a) table; `node summarize.mjs screenshot` per scenario
```

Raw results in `out/*.json`; a few sample PNGs in `out/` (the rest were not
kept). Headed runs open browser windows.

---

## (a) `figcraft.screenshot()` and how to get pixels

### Why it hangs (from the source)

1. **Every `window.figcraft` call waits for an editor frame.** `apps/figcraft-web/src/api.rs`
   pushes the request on a queue, calls `ctx.request_repaint()` and polls for the reply every
   16 ms; the app drains the queue during its next eframe frame. eframe's web runner draws from
   `requestAnimationFrame`, so a page the browser stops painting (background tab, minimised or
   fully covered window) answers nothing. `craft-web-api` rejects after **30 s** ("figcraft did
   not answer … within 30 s (a hidden tab answers when it is shown again)") and the request is
   cancelled unrun. This applies to `execute`, `docInspect` and `ui.render` as much as to
   `screenshot`.
2. **`ui.screenshot` needs several more frames that nothing forces in the browser.**
   `crates/ui-egui/src/control.rs`: a shot is admitted, must see `SHOT_SETTLE_PASSES = 3`
   completed frames, is then issued as `ViewportCommand::Screenshot` (eframe reads the surface
   back on the next paint), and the image is drained and PNG-encoded in wasm on a later frame. To
   keep frames coming it sends `ViewportCommand::RequestPaintWhileHidden`, which eframe's web
   runner **does not implement**: every screenshot logs `Unhandled egui viewport command:
   RequestPaintWhileHidden - not implemented in web backend`. The only other wake-up it schedules
   is `repaint_in(deadline)`, 60 s later, past the page API's 30 s. So a screenshot completes only
   if something else happens to repaint the editor four or five times. Usually something does;
   sometimes nothing does, and the call times out even with the page visible.
3. Not a GPU readback problem: the hang shows on WebGL2 (Firefox headless), the readback itself
   is eframe's render-to-texture (no `preserveDrawingBuffer` involved), and keeping the editor
   repainting removes it (below). Upstream lists the gap (`docs/control-protocol.md`: "hidden-tab
   screenshots and injected input are unqualified there").

### Reproduction

| setup | result |
|---|---|
| Playwright, 8 configs × {no doc, 24 nodes, largest example, 5,000 nodes, second tab in front} × 10 tries | **Chromium and Chrome headless and headed, Firefox headed, WebKit headless and headed: 50/50 each, no hang.** The original "headless Chromium with a document open" timeout did **not** reproduce (0/100 headless Chromium/Chrome calls failed). |
| Firefox 157 headless (WebGL2), same matrix | **42/50**; a 20-try re-run **54/60**. Every failure is the 30 s page timeout, in every scenario including no document. |
| Firefox headless, same 60 tries, with a cheap `window.list` request every 16 ms while the shot is pending (`screenshotNudge`) | **60/60**, p50 149–151 ms, p95 ≤ 156 ms. Each request asks egui for a repaint, standing in for the missing `RequestPaintWhileHidden`: confirms cause 2. |
| Chrome 158 and Chrome for Testing 156 started **without Playwright** (`probe-realhidden.mjs`, raw CDP, fresh profile), window in the background (`visibilityState` `hidden`, 0 rAF callbacks in 2 s) | `docInspect`, `execute node.create`, `ui.render` and `screenshot` **all failed at 30.4–31.1 s**: 4/4 calls in each of 3 runs (tab, minimised, Chrome for Testing). Confirms cause 1. |
| The same under Playwright (tab behind another, or window minimised over CDP, with or without its anti-throttling flags) | everything answers: Playwright's focus emulation keeps `visibilityState` `visible` and rAF running. Chromium minimised: screenshot 3.2–3.5 s (rAF throttled to ~45/s); a request sent while minimised answered 18–38 ms after restore. |

### Methods compared (10 tries per cell; p50 range over scenarios, worst p95 over scenarios)

`screenshot` = `figcraft.screenshot()` (window incl. UI); `render` = `request('ui.render',
{scale: 1})` (document only; `export` = `execute('file.export', {format: 'png'})`, which `ui.render`
calls, measured within a few ms of it); `pwPage` = Playwright `page.screenshot()`; `pwCanvas` =
Playwright element screenshot of `#figcraft_canvas`; `toDataURL` = `canvas.toDataURL()`. "blank" =
one distinct colour in the image.

| browser | backend | screenshot | render | pwPage | pwCanvas | toDataURL |
|---|---|---|---|---|---|---|
| Chrome 158 headed | WebGPU | 50/50 · 149–260 ms · p95 1126 | 40/40 · 18–341 · p95 354 | 50/50 · 32–47 | 50/50 · 49–67 | 50/50 · pixels |
| Chrome 158 headless | WebGPU | 50/50 · 117–160 · p95 197 | 40/40 · 18–378 · p95 453 | 50/50 · 33–68 | 50/50 · 66–149 | 50/50 · pixels |
| Chromium 156 headed | WebGPU | 50/50 · 139–535 · p95 968 | 40/40 · 17–329 · p95 345 | 50/50 · 26–42 | 50/50 · 44–58 | 50/50 · pixels |
| Chromium 156 headless-shell | WebGL2 | 50/50 · 191–253 · p95 419 | 40/40 · 62–399 · p95 540 | 50/50 · 17–34 | 50/50 · 66–81 | **blank** in 5/5 scenarios |
| Firefox 157 headed | WebGPU | 50/50 · 202–307 · p95 800 | 40/40 · 20–401 · p95 524 | 50/50 · 28–38 | 50/50 · 63–73 | 50/50 · pixels |
| Firefox 157 headless | WebGL2 | **96/110** (timeouts) · 143–162 · p95 287 | 40/40 · 25–411 · p95 551 | 50/50 · 14–41 | 50/50 · 48–109 | **blank** 5/5 |
| WebKit 27.2 headed | WebGPU | 50/50 · 117–133 · p95 147 | 40/40 · 18–307 · p95 320 | 50/50 · 12–16 | 50/50 · 34–50 | 50/50 · pixels |
| WebKit 27.2 headless | WebGPU | 50/50 · 117–133 · p95 165 | 40/40 · 18–300 · p95 308 | 50/50 · 13–16 | 50/50 · 33–50 | 50/50 · pixels |

Notes:
- `ui.render` runs the `tiny-skia` CPU renderer (`crates/render`) inside a frame: its cost grows
  with the area rendered (18 ms for a 500×180 page, 300–400 ms for the 1440×960 example with
  effects and text, 180–410 ms for 5,000 nodes over 5180×4180 px), and it blocks the editor's main
  thread for that time. It does not touch the GPU, the canvas or the view, so it is deterministic:
  `out/shot-chrome-headed-example-render.png` and `out/shot-chromium-headless-example-render.png`
  are byte-identical (257,519 bytes), and it is the same renderer as headless `figcraft-cli`.
- `screenshot` encodes a full-window PNG in wasm (2880×1800 at DPR 2: 150–550 ms) and includes
  the editor chrome.
- `toDataURL` is fast but blank on WebGL2 (no `preserveDrawingBuffer`); it returns pixels only on
  WebGPU. Not dependable.
- Playwright screenshots are compositor captures: fastest and never hung, but exist only in tests.

### Recommendation

1. **Agent checks: `ui.render`** with `ids` (the frame or layers it changed) and a `scale` that
   keeps the image ≤ ~1600 px on its long side. Document-only pixels, deterministic, no UI chrome,
   no GPU readback, 360/360 calls succeeded in all 8 configs. Don't call `figcraft.screenshot()`
   from product code. If a "what the user sees" capture is ever needed, the bridge must keep the
   editor repainting while it waits (a 16 ms `window.list` ping: 60/60), and the fork should fix
   it at the source (call `request_repaint` while a capture settles, or implement
   `RequestPaintWhileHidden` in the egui fork's web runner).
2. **Thumbnails: `ui.render` of the page (or its first top-level frame) at a scale computed from
   the page bounds** (0.1–0.25 here: 17–60 ms for the examples, 85–515 ms for 10k–30k nodes).
   Make them from the saved file with headless `figcraft-cli` (Story 4.5's sandbox already has it)
   rather than in the user's tab, so a hidden tab can't stall them and the editor's main thread
   isn't blocked. An unbounded page render fails on large pages (30k nodes at scale 1).
3. **The bridge must handle "editor not painting"**: check `document.visibilityState` before
   sending agent tool calls, pause the turn (and say so) while hidden, and treat the 30 s
   rejection as retryable: per `api.rs` the request was dropped unrun.
4. Tests (Playwright): `ui.render` for assertions on the document, `page.screenshot()` for visual
   snapshots of the shell.

---

## (b) Change detection without events

### What exists

- `document.inspect {depth?, allPages?, fields?, outline?}` (exact name and params from
  `docs/control-protocol.md`; `fields: []` keeps ids and structure; `depth` is capped at 64).
  Every reply carries `dirty`, `selection`, `currentPage`, `pages` and `history: {undo: <last 20
  labels>, redo: <count>}` (`crates/engine/src/automation/inspect.rs`).
- **No exposed revision counter.** The engine has `DocState.revision: u64`
  (`crates/engine/src/doc_state.rs`, bumped on edits, page and view changes; the UI uses it to
  invalidate caches), but no method or command returns it. `Session::undo_depth()` gives exact
  undo/redo lengths, but only `redo` is exported. `events.poll` exists only on the desktop control
  socket (not in `window.figcraft`) and emits comment events only. `figcraft:dirty` only flips on
  the first change after a save.

### Prototype: `change-detect.ts`

Two tiers, run in the host page through `window.figcraft`:
1. **Gate**: `docInspect({depth: 0, fields: []})`, 0.2–0.4 KiB whatever the size. Key = doc id +
   current page + `history` + each page's `childCount`.
2. **Full**, only when the gate key changes (plus a backstop every `fullEveryMs`):
   `docInspect({depth: 64, fields: [name, type, x, y, width, height, rotation, visible, locked,
   opacity, fills, strokes, strokeWeight, effects, cornerRadius, characters]})`, flattened to
   `id → record (+ parent, child ids)` and diffed → `{added, removed, changed: [{id, fields}],
   meta: {selection, page, history, dirty}}`.

### Correctness (1,000-node document; identical results in Chrome, Firefox and WebKit)

| change | detected |
|---|---|
| `node.set` fill on one rectangle | `changed [{id 3, fields [fills]}]` |
| `node.set` x, y on two frames | both ids, `[x, y]` |
| create 3 ellipses (one batch) | `added 3` |
| delete a frame with 11 children | `removed 12` |
| rename | `[name]` |
| selection only | `meta.selection`; gate only, no full inspect |
| undo | the rename reverted: `[name]` |
| **a person's mouse drag on the canvas** (real Playwright mouse, undo label "Move") | `changed [{id 3, [x, y]}]` in Chrome and Firefox. In WebKit the synthetic drag moved nothing (no undo step), so it is untested there |
| **undo, then an edit with the same label** | **missed by the gate** (the 20 labels and the redo count are unchanged); only the backstop full poll catches it |

Other blind spots of the gate by construction: more than 20 steps with the same label (repeated
nudges), edits on pages other than the current one (needs `allPages`), and changes that make no
undo step.

### Cost per poll vs document size

10 reps, p50 wall ms from the call to the resolved promise · JSON payload. The wall time includes
waiting for the next frame and `api.rs`'s 16 ms reply poll, so ~17 ms (Chrome, WebKit) or ~23 ms
(Firefox) is the floor.

| | gate | ids only (`fields: []`) | `outline: true` | 16 diff fields | everything (no `fields`) | JS flatten + diff |
|---|---|---|---|---|---|---|
| Chrome, 100 nodes | 17.0 · 0.2 KiB | 16.8 · 1.3 KiB | 17.0 · 6 KiB | 16.9 · 14 KiB | 17.3 · 25 KiB | 0.1 ms |
| Chrome, 1,000 | 17.1 · 0.2 | 17.3 · 12 | 18.4 · 59 | 19.4 · 140 | 21.1 · 246 | 0.9 |
| Chrome, 5,000 | 16.7 · 0.3 | 18.3 · 63 | 21.1 · 297 | 27.1 · 702 | 37.8 · 1,241 | 3.4 |
| Chrome, 10,000 | 17.2 · 0.4 | 19.7 · 127 | 24.9 · 595 | **44.6 · 1,405** | **74.8 · 2,485** | 6.5 |
| Firefox, 10,000 | 24 | 29 | 32 | 58 | 91 | 13 |
| WebKit, 10,000 | 17 | 20 | 30 | 39 | 65 | 9 |

Main-thread blocking (longest rAF gap during one call, Chrome at 120 Hz): one frame (8.3 ms) for
every variant up to 5,000 nodes; at 10,000 nodes 16.7 ms for the diff-fields inspect and 33.4 ms
for an unfiltered one. Full per-browser numbers: `out/change-<browser>.json`.

### Frame times while a person pans and zooms

Headed, 5 s of wheel and ctrl-wheel input, rAF deltas in the editor frame: p95 / max ms /
frames over 25 ms. `gated-N` = the detector polling every N ms (one full inspect at start; the
document doesn't change while panning). `full-N` = a diff-fields full inspect every N ms.

| browser, nodes | no polling | gated-1000 | gated-250 | full-1000 | full-250 |
|---|---|---|---|---|---|
| Chrome (120 Hz), 1k | 9.9 / 26 / 1 | 9.8 / 10 / 0 | 9.9 / 10 / 0 | 9.9 / 50 / 1 | 9.8 / 10 / 0 |
| Chrome, 5k | 10.1 / 33 / 1 | 9.8 / 17 / 0 | 9.5 / 10 / 0 | 9.8 / 27 / 1 | 9.7 / 18 / 0 |
| Chrome, 10k | 16.7 / 50 / 3 | 9.9 / 32 / 2 | 10.0 / 24 / 0 | 10.1 / 50 / 7 | **16.7 / 43 / 16** |
| Firefox (60 Hz), 1k | 16.9 / 33 / 6 | 16.8 / 50 / 4 | 16.9 / 18 / 0 | 16.7 / 18 / 0 | 16.8 / 18 / 0 |
| Firefox, 5k | 17.4 / 50 / 12 | 17.3 / 34 / 13 | 17.0 / 33 / 7 | 16.9 / 34 / 10 | **33.3 / 67 / 17** |
| Firefox, 10k | 17.2 / 34 / 8 | 16.8 / 50 / 8 | 16.7 / 50 / 2 | 16.7 / 83 / 6 | **50 / 83 / 14** |
| WebKit (60 Hz), 1k | 18 / 22 / 0 | 18 / 19 / 0 | 18 / 19 / 0 | 18 / 19 / 0 | 18 / 24 / 0 |
| WebKit, 5k | 18 / 19 / 0 | 18 / 23 / 0 | 18 / 25 / 0 | 18 / 30 / 4 | **24 / 34 / 14** |
| WebKit, 10k | 18 / 21 / 0 | 18 / 51 / 1 | 18 / 46 / 1 | 18 / 60 / 5 | **49 / 60 / 15** |

p50 was 8.3 ms (Chrome) or 16.7–17 ms (Firefox, WebKit) in every cell. The gate costs nothing
measurable at any size; a full inspect every 250 ms hurts panning from 5,000 nodes (Firefox,
WebKit) or 10,000 (Chrome); every 1 s it adds a few dropped frames. (`out/change-<browser>.json`
has a first frame-time run that leaked pollers between modes and is superseded by
`out/change-<browser>-frames.json`.)

### Recommendation until Story 2.3 lands

Ship the two-tier detector in `packages/bridge`:
- poll the **gate every 250–500 ms** while the tab is visible (≈17 ms wall, < 0.5 KiB, no dropped
  frames at 10k nodes); stop when `document.visibilityState` is `hidden` (calls would hang anyway);
- run the **full diff-fields inspect only when the gate changes, debounced** (≥ 300 ms after the
  last gate change, so a drag yields one diff), **before every agent turn** (the agent's "what
  changed since I last looked"), and as a **backstop every 5–10 s while idle** to cover the gate's
  blind spots (~45 ms per 10k nodes);
- label the author in the host: diffs observed while the bridge itself is running the agent's
  commands are the agent's, everything else is the person's. Inspect can't tell who made a change;
  that stays Story 2.3's job.
- **Cheapest fork patch, worth doing before 2.3:** add `revision` (and the undo depth) to
  `document.inspect`'s metadata (a few lines in `automation/inspect.rs`). It makes the gate exact
  and removes every blind spot above, and it is easy to upstream.

---

## (c) Large files

FigCraft's `examples/` are small (43–59 KiB, 97–362 nodes), so `large.mjs gen` adds two generated
files (grids of frames, each with 10 rectangles and a text): 10,000 nodes (290 KiB) and 30,000
nodes (522 KiB). Every file was opened in a fresh browser through `figcraft:open` from the host
page.

Open and memory (ready = host page navigation start to figcraft:ready; open = figcraft:open posted to a document present / to the first refined canvas; wasm = WebAssembly.Memory after open → after panning):

| file | KiB | nodes | chrome-headed 158.0.8127.37 | firefox-headed 157.0 | webkit-headed 27.2 | chromium-headless 156.0.8078.4 |
|---|---|---|---|---|---|---|
| glass-and-vectors | 51 | 97 | ready 144 · open 645/725 ms · wasm 87→87 MiB · JS 4.7 | ready 185 · open 189/707 ms · wasm 87→107 MiB | ready 355 · open 169/247 ms · wasm 41→41 MiB | ready 176 · open 226/260 ms · wasm 47→47 MiB · JS 5.3 |
| ridgeline-app | 57 | 348 | ready 73 · open 275/352 ms · wasm 79→79 MiB · JS 5.5 | ready 205 · open 112/370 ms · wasm 79→99 MiB | ready 357 · open 129/147 ms · wasm 40→45 MiB | ready 105 · open 182/200 ms · wasm 46→46 MiB · JS 5.8 |
| ridgeline-design-system | 43 | 362 | ready 71 · open 139/156 ms · wasm 73→73 MiB · JS 5.7 | ready 200 · open 101/206 ms · wasm 73→73 MiB | ready 354 · open 113/130 ms · wasm 40→40 MiB | ready 106 · open 158/191 ms · wasm 45→59 MiB · JS 6 |
| ridgeline-onboarding | 44 | 142 | ready 70 · open 160/177 ms · wasm 74→94 MiB · JS 4.8 | ready 208 · open 130/236 ms · wasm 73→93 MiB | ready 306 · open 113/131 ms · wasm 40→40 MiB | ready 107 · open 157/190 ms · wasm 45→59 MiB · JS 5.2 |
| ridgeline-studio-dashboard | 59 | 268 | ready 61 · open 407/487 ms · wasm 80→100 MiB · JS 5.3 | ready 194 · open 351/489 ms · wasm 79→99 MiB | ready 333 · open 95/206 ms · wasm 41→41 MiB | ready 107 · open 213/354 ms · wasm 47→47 MiB · JS 5.6 |
| gen-10000 | 290 | 10000 | ready 58 · open 195/211 ms · wasm 79→79 MiB · JS 7.1 | ready 198 · open 155/262 ms · wasm 79→79 MiB | ready 343 · open 169/186 ms · wasm 45→45 MiB | ready 80 · open 236/274 ms · wasm 49→63 MiB · JS 9.7 |
| gen-30000 | 522 | 30000 | ready 73 · open 317/337 ms · wasm 124→144 MiB · JS 15.5 | ready 255 · open 325/439 ms · wasm 124→124 MiB | ready 354 · open 264/348 ms · wasm 98→98 MiB | ready 106 · open 369/417 ms · wasm 99→108 MiB · JS 16.2 |

Pan/zoom frame times (5 s, rAF deltas ms: p50 / p95 / max, frames over 25 ms of total) and ui.render cost (ms at scale 0.1 / 0.25 / 1):

| file | chrome-headed | firefox-headed | webkit-headed | chromium-headless |
|---|---|---|---|---|
| glass-and-vectors | 8.3 / 24.9 / 50.9 (20/492) · render 19 / 38 / 338 | 16.7 / 316.7 / 416.7 (36/92) · render 18 / 39 / 422 | 17 / 18 / 30 (3/300) · render 27 / 61 / 350 | 16.7 / 16.8 / 33.4 (10/292) · render 39 / 63 / 357 |
| ridgeline-app | 8.3 / 16.8 / 33.4 (6/536) · render 23 / 39 / 263 | 16.7 / 33.3 / 83.3 (25/255) · render 29 / 48 / 271 | 17 / 18 / 32 (1/300) · render 35 / 50 / 262 | 16.7 / 33.3 / 33.4 (17/283) · render 43 / 66 / 281 |
| ridgeline-design-system | 8.3 / 9.7 / 16.9 (0/599) · render 22 / 29 / 164 | 16.7 / 16.8 / 66.6 (4/295) · render 19 / 28 / 184 | 17 / 18 / 28 (1/299) · render 24 / 39 / 153 | 16.7 / 33.3 / 33.4 (24/279) · render 42 / 52 / 188 |
| ridgeline-onboarding | 8.3 / 10 / 58.4 (2/578) · render 18 / 23 / 120 | 16.7 / 33.3 / 66.7 (16/278) · render 26 / 37 / 145 | 17 / 18 / 26 (1/300) · render 16 / 21 / 137 | 16.7 / 16.8 / 33.5 (11/293) · render 40 / 49 / 149 |
| ridgeline-studio-dashboard | 9.2 / 91.7 / 191.7 (65/174) · render 17 / 28 / 550 | 16.7 / 350 / 550.6 (25/67) · render 24 / 45 / 299 | 17 / 18 / 19 (0/299) · render 33 / 47 / 303 | 16.7 / 33.3 / 50 (28/272) · render 42 / 57 / 331 |
| gen-10000 | 8.3 / 10.2 / 18.1 (0/578) · render 85 / 144 / 629 | 16.7 / 17.2 / 33.7 (11/290) · render 125 / 182 / 798 | 17 / 18 / 23 (0/299) · render 89 / 136 / 584 | 16.7 / 33.4 / 33.4 (61/239) · render 105 / 177 / 633 |
| gen-30000 | 8.4 / 25 / 33.5 (20/455) · render 217 / 440 / fail | 16.7 / 33.3 / 50 (46/253) · render 288 / 514 / fail | 17 / 18 / 25 (0/300) · render 202 / 404 / fail | 33.3 / 33.4 / 50 (106/196) · render 245 / 468 / fail |

Idle editor before any file (host mode home screen): wasm chrome-headed 30.5 MiB, firefox-headed 30.5 MiB, webkit-headed 30.5 MiB, chromium-headless 30.9 MiB

Reading the numbers:
- **Loading is not a risk.** The editor is ready 60–360 ms after navigation (wasm cached by the
  local server; a cold 4.5 MiB Brotli download comes on top). A 30,000-node file opens and shows a
  refined canvas within 340–440 ms in every browser.
- **Memory is the wasm heap**: 30.5 MiB idle, 40–100 MiB with an example open, 98–144 MiB with
  30,000 nodes; it grows in 20 MiB steps while panning (render caches) and never shrinks
  (wasm memory can't). JS heap stays at 4–16 MiB. Headed Chromium/Firefox run at DPR 2, WebKit and
  headless at DPR 1, which is most of the 40 vs 80 MiB difference.
- **Frame times depend on effects and pixels, not node count.** 10,000 plain nodes pan at
  display rate in every headed browser (Chrome p95 10.2 ms at 120 Hz; 0 frames over 25 ms). The
  268-node `ridgeline-studio-dashboard` example (shadows, blurs, gradients) is the worst file:
  at DPR 2 Chrome drops 65 of 174 frames (p95 92 ms, max 192 ms) and Firefox 25 of 67 (p95
  350 ms); at DPR 1 WebKit and headless Chromium stay smooth on it. `glass-and-vectors`
  (backdrop blur) is the second worst in Firefox (p95 317 ms).
- `ui.render` of the whole page fails at scale 1 for 30,000 nodes (`render failed (empty or too
  large)`, all browsers) and costs 0.6–0.8 s for 10,000 nodes; at scale 0.1 it is 17–43 ms for
  the examples and 85–290 ms for 10k–30k nodes.

Memory APIs: `performance.measureUserAgentSpecificMemory` is unavailable (the page isn't
cross-origin isolated, `crossOriginIsolated === false`; Firefox and WebKit don't ship it);
`performance.memory` and CDP `Performance.getMetrics` exist only in Chromium. The wasm number is
`WebAssembly.Memory.buffer.byteLength`, reached through Trunk's `TrunkApplicationStarted` event
(`addInitScript`). `ui.inspect`'s `frameTimes` stays `{frames: 0}` in the browser, so frame times
are rAF deltas measured inside the editor frame under synthetic wheel / ctrl-wheel input.

---

## What SPEC.md should change

- **Story 0.4 text**: the timeout is not specific to headless Chromium. Every bridge call waits
  for an editor frame (so all calls hang while the tab is hidden), and `ui.screenshot` also needs
  repaints the web runner never forces (intermittent hang even when visible: 14/110 in Firefox
  headless).
- **Story 1.3 (`packages/bridge`)**: `render` = `ui.render` with `ids` and `scale`; drop
  `screenshot` from the API (tests only, with a repaint nudge). Add the two-tier change detector
  (`onChange`) to the bridge's surface. Add to the AC: "a call made while the editor tab is hidden
  fails fast with a typed `EditorHidden` error instead of waiting 30 s".
- **Known risk 3 / Story 4.2**: interactive agent tools stop entirely while the tab is in the
  background, not only when it is closed. "A closed tab ends an interactive turn" → "a closed or
  hidden tab pauses an interactive turn; long work goes to jobs".
- **Epic 2**: add a small patch ahead of 2.3: expose `revision` / undo depth in
  `document.inspect`, and make `ui.screenshot` settle in the browser (`request_repaint` while a
  capture is pending). Both are upstreamable (§10 Q2).
- **Epic 3 (thumbnails)**: render thumbnails from the saved file with headless `figcraft-cli`
  (`ui.render` at a scale computed from the bounds), not from the user's tab.
- **Risks**: load time and node count are not a risk at 10–30k simple nodes (< 0.5 s to open,
  < 150 MiB). Heavy effects at DPR 2 are: the 268-node dashboard example pans at p95 92 ms in
  Chrome and 350 ms in Firefox. Worth a line under Epic 2 / 8 (performance budget on effects).

## Unresolved

- The original "headless Chromium + open document" timeout was not reproduced with Playwright
  1.64 (0/100 headless Chromium/Chrome screenshot calls failed). Both reproduced hangs (Firefox
  headless, hidden tab) are explained by the source; if the original came from another harness
  (an MCP-driven browser, an older Playwright) it is most likely one of them.
- "A request sent while hidden answers once shown" was not measurable without Playwright on this
  Mac: the spawned Chrome window stayed occluded (`visibilityState` `hidden` even after `open -a`
  and `Page.bringToFront`). Under Playwright it answered 18–38 ms after restore.
- WebKit: a synthetic mouse drag on the canvas didn't move the layer, so person-edit detection is
  untested there (control-channel edits were detected).
- Frame times are rAF deltas under synthetic input; GPU frame cost was not measured, and
  `ui.inspect`'s `frameTimes` is empty in the browser.
- The wasm was served from localhost with no compression; cold-load time over the network (4.5 MiB
  Brotli) is Story 0.1's to measure.
