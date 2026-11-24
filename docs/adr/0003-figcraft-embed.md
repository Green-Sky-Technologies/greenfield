# ADR 0003: Embed a FigCraft fork as the editor (Epic 0 results)

- **Status:** Proposed. The 0.3 gate passed; the recommendation is **go**, under the conditions
  below.
- **Stories:** 0.1, 0.2, 0.3, 0.4 (SPEC §9 D19)
- **Date:** 2026-11-24
- **Raw findings:**
  - [`spikes/0.1-embed/FINDINGS.md`](../../spikes/0.1-embed/FINDINGS.md)
  - [`spikes/0.2-fork-build/FINDINGS.md`](../../spikes/0.2-fork-build/FINDINGS.md)
  - [`spikes/0.3-agent/FINDINGS.md`](../../spikes/0.3-agent/FINDINGS.md), with renders in
    [`spikes/0.3-agent/out/REPORT.md`](../../spikes/0.3-agent/out/REPORT.md)
  - [`spikes/0.4-browser/FINDINGS.md`](../../spikes/0.4-browser/FINDINGS.md)

## Context

D19 replaces the HTML-frame editor with an embedded fork of FigCraft (v0.18.1, `figcraft-web`),
subject to Story 0.3: if the agent draws clearly worse with editor commands than with HTML, and no
prompt or tool change fixes it, we keep the HTML-frame editor. Epic 0 ran four throwaway spikes,
in parallel, to test that and the embedding risks.

## Decision

**Go: proceed with D19 into Phase 1.** The agent is not worse with FigCraft commands (0.3).
Embedding, saving and reopening work in all three engines (0.1). The fork builds reproducibly
(0.2). The browser problems are understood and have workarounds (0.4).

Conditions to carry into Phase 1 (SPEC changes are listed at the end):

1. Ship a save acknowledgement before real users. Today dirty clears before the upload is stored.
2. Fix fonts deliberately: either bundle the design-system fonts or report missing fonts to the
   agent. A silent fallback was the main quality bug in 0.3.
3. Re-baseline the size budget. Upstream's own v0.18.1 wasm is already over 24 MiB.
4. Treat the editor bundle as trusted, same-origin code: pinned by sha256 or built by us.

## Results

### 0.3 Can Claude draw? (the gate)

Setup:

- Model: `claude-sonnet-5-5` through the AI Gateway via `packages/providers`, the same model for
  both arms.
- Prompts: the 6 golden prompts plus 2 extra build-a-screen prompts (pricing + FAQ, testimonials),
  because every golden prompt is a small edit and the Epic 0 demo is building a screen.
- FigCraft arm: Claude drives headless `figcraft-cli mcp` with `batch` and renders its own work.
  The landing fixture was rebuilt in FigCraft.
- Best variant: `v2`, repeated 3 times.

|                                          | FigCraft `v2`                | HTML-frame agent          |
| ---------------------------------------- | ---------------------------- | ------------------------- |
| Golden pass rate (3 runs)                | 17/18                        | 12/18 ¹                   |
| Small edit: cost / wall time             | $0.006–0.012 / 3–6 s         | $0.013–0.021 / 2–6 s      |
| Build pricing + FAQ: cost / turns / wall | $0.158 / 8–10 / 46–53 s      | $0.124 / 3–4 / 37–48 s    |
| Build testimonials: cost / turns / wall  | $0.089 / 6–10 / 34–39 s      | $0.088 / 5 / 25–26 s      |
| Visual quality (judged by eye)           | on par; better pricing cards | on par; stray FAQ borders |

1. All 6 HTML failures are the two job hand-off cases: the HTML agent asks clarifying questions
   (`ask_questions`) instead of offering a job. That's existing behaviour, not a drawing problem.

Renders side by side:

- [pricing + FAQ, `v2`](../../spikes/0.3-agent/out/v2/x-build-pricing/)
- [pricing + FAQ, `v1`](../../spikes/0.3-agent/out/v1/x-build-pricing/)
- [testimonials, `v1`](../../spikes/0.3-agent/out/v1/x-build-testimonials/)
- [density control, `v2`](../../spikes/0.3-agent/out/v2/density-slider/)
- [every case and variant](../../spikes/0.3-agent/out/REPORT.md)

**What we tried.** Eight variants were run on the golden set (see the table in the 0.3 findings).

| Variant                                | Golden pass | Cost for 6 cases | Result                                      |
| -------------------------------------- | ----------- | ---------------- | ------------------------------------------- |
| Full 645-command catalog in the prompt | 5/6         | $0.53            | about 4× the cost, no gain                  |
| One command per call (no `batch`)      | 6/6         | $0.14            | more turns, one undo step per command       |
| Render attached after every edit       | 5/6         | $0.13            | no gain                                     |
| Short prompt, outline-only context     | 5/6         | $0.29            | more turns spent reading                    |
| `v1`                                   | 5/6         | $0.15            | builds were clearly worse than HTML (below) |
| **`v2`** = `v1` + craft rules          | 6/6         | $0.16            | fixed it                                    |

`v1` built pricing cards with Regular-weight headings and ragged card heights. `v2` adds these
rules:

- Always set `fontFamily` along with `fontStyle`.
- Copy sibling section styles.
- Use `sizingV: fill` cards with a spacer so buttons sit at the bottom.
- Build in one batch, render, then fix.

**Best shape:**

- Tools: `batch` (one undo step per edit), `get_node`, `render` (on request) and
  `suggest_generation_job`.
- Context: the scope subtree plus the page outline.
- Prompt: a curated command reference and the `v2` craft rules.

**Failure modes to design for:**

- **Silent font fallback.** `inspect` says Bold while the render is Regular, because the default
  font is Inter and Inter wasn't available.
- **Layout idioms** need to be in the prompt.
- **Scope.** An added control sometimes lands next to the scoped section instead of inside it.

**Caveats:**

- The quality judgement is mine and not blind.
- One fixture and two build prompts.
- FigCraft renders came from the CLI's CPU `screenshot`, not the browser.
- Total spend for the gate: about $4.59.

### 0.1 Embed in Next.js: all four ACs pass in Chromium, WebKit and Firefox (3 runs each)

**Numbers:**

- Release zip: 10.5 MB (sha256 pinned). Wasm: **25,503,950 B (24.3 MiB) raw**, 10.4 MB gzip,
  7.4 MB Brotli.
- Cold `figcraft:ready`: 0.57–0.75 s on localhost (2.3–2.7 s on a loaded machine).
- Save → stored: 50–590 ms. Reopen: 24–380 ms.

**Setup:**

- Real Clerk sign-in. Authorization goes through `getProject` / `assertCan('design:edit')`.
- Storage was the **local-filesystem fallback**: no `BLOB_READ_WRITE_TOKEN` locally, so the
  Vercel Blob path type-checks but never ran.

**Findings:**

- WebKit on a Mac needs Cmd+S (`ui.key {cmd:true}`), not Ctrl+S.
- **Saves carry no `id`, so dirty clears before the host stores the bytes.** A failed upload
  looks saved.
- Vercel's 4.5 MB function body limit means saves need client uploads to Blob.
- Same-origin host mode gives the editor full app-origin access, including Clerk's readable
  `__session` cookie.
- No COOP/COEP needed. Cache headers added: `immutable` for wasm/js, `no-cache` for
  `index.html`.

### 0.2 Fork build: reproducible; size target needs restating

**Build:** v0.18.1 (`4acc293c`) with the pinned craft-libs and egui-fork revisions, trunk 0.22.2
and rustc 1.100.

|                              | Time      | Raw wasm                                |
| ---------------------------- | --------- | --------------------------------------- |
| Local Mac                    | 224 s     | 23,776,058 B (22.7 MiB), 6.5 MiB Brotli |
| Clean `rust:1.100` container | 441–517 s | 23,672,083 B                            |

**Reproducibility:** two clean container builds came out byte-identical. Local and container
bytes differ because they use different wasm-opt versions (133 vs 131).

**Size:** our build fits under 24 MiB only because it leaves out `storytold/craft-fonts`. The
upstream release with fonts is 24.3 MiB. Upstream's own gate is actually 25 MiB.

Once craft-fonts and the winit fork were approved (2026-11-24), we ran a release-equivalent build:
craft-fonts at upstream's CI ref `37827adc`, `KEEP_WINIT_FORK=1`, plus our theme patch.
- Raw wasm: **25,579,895 B (24.39 MiB)**, 76 KB more than upstream's release. It fails the 24 MiB
  AC and is about 0.6 MiB under upstream's 25 MiB gate.
- Gzip 10,376,170 B; Brotli 7,366,446 B.
- Build time: 206 s for the trunk build, 278 s wall in total.

So a build with fonts can't meet the AC as written. See SPEC change 1.

**Inputs:** `build.sh` drops the pinned `storytold/winit` fork. It isn't used on the web.

**Theme change:** the selection colour moved green → pink with an 8-line patch to
`crates/ui-egui/src/theme.rs`. It shows standalone and embedded. `ui.render` leaves out the
selection highlight, so the check used page screenshots.

**CI:** the workflow `.github/workflows/figcraft-web.yml` passes actionlint but has not run on
GitHub. binaryen comes from Debian sid, which needs pinning.

**Licences:** FigCraft, craft-libs and the egui fork are MIT OR Apache-2.0, which is compatible
with AGPL-3.0 one-way. The fonts are OFL. The ArtCraft/FigCraft name and logos are trademarks,
so the rebrand must replace them.

### 0.4 Real-browser checks

**(a) Pixels.**

- The headless-Chromium screenshot timeout **did not reproduce**: 0 failures in 100 calls.
- Two real hangs were reproduced and explained from the source:
  1. **Hidden tab.** Every `window.figcraft` call waits for an editor frame, and hidden tabs draw
     none. In real Chrome over raw CDP, 12 of 12 calls failed at about 30 s. Playwright hides
     this because it keeps pages "visible".
  2. **`ui.screenshot` in headless Firefox** failed 14 of 110 calls (a missed repaint). A repaint
     nudge fixed it: 60 of 60.
- `ui.render` worked 360 of 360 times across 8 browser configs, in 18–400 ms. It fails at scale 1
  on a 30k-node page. `canvas.toDataURL()` comes back blank on WebGL2.
- **Use `ui.render` with `ids` and `scale`.** Fail fast when the tab is hidden.

**(b) Change detection.**

- A small `document.inspect` (depth 0, no fields) used as a gate costs about 17 ms and under
  0.5 KiB at any size.
- A full diff with `fields` costs 45 ms and 1.4 MiB at 10k nodes. Running it every 250 ms hurts
  panning from 5k nodes.
- **Until 2.3:** poll the gate every 250–500 ms. Run the full diff when the gate changes, before
  each agent turn, and as a 5–10 s backstop.
- Blind spot: an undo followed by an edit with the same label. Exposing the engine's `revision`
  counter fixes it.

**(c) Large files.**

- 30k nodes open in 0.34–0.44 s and use 98–144 MiB of wasm memory. 10k plain nodes pan smoothly.
- The 268-node effects-heavy dashboard example at DPR 2 doesn't: pan p95 is 92 ms in Chrome and
  350 ms in Firefox.

## Consequences

- Phase 1 can start: the rename, the embed (Story 1.x), and the removal of the HTML-frame editor.
- The agent's system prompt starts from the 0.3 `v2` prompt and tool shape.
- Small fork patches join Epic 2 early:
  - a save `id` / acknowledgement;
  - `revision` in `document.inspect`;
  - a repaint while a screenshot is pending;
  - missing-font warnings in command results.
- Open items:
  - Vercel Blob has never run end to end; it needs a token in a preview environment.
  - The CI workflow has never run on GitHub.
  - Approve or reject `storytold/craft-fonts` and `storytold/winit` as build inputs.

## Proposed SPEC.md changes (not applied)

1. **Risk 5 / Story 0.2 / Story 8.2.**
   - Replace "about 18 MiB raw (4.5 MiB Brotli)" with the measured sizes: 22.7 MiB without
     fonts, 24.3 MiB as released, 6.5–7.4 MiB Brotli.
   - Restate the AC: either 25 MiB (upstream's gate) or "<24 MiB without craft-fonts", with our
     own CI size check.
2. **Story 0.2 / Epic 2.** Name the extra upstream inputs, `storytold/craft-fonts` (OFL) and the
   `storytold/winit` fork, and decide on them. Add a full-rebrand story: wordmark, icon,
   trademarked name, loading screen.
3. **Save acknowledgement (Story 2.3 or a new Epic 2 patch).** Saves carry an `id`, and dirty
   clears only on `figcraft:saved`.
4. **Upload path (Epic 3).** Client uploads to private Blob through an authenticated
   `handleUpload` route; no function bodies over 4.5 MB.
5. **Trust boundary (§3 / Epic 8).**
   - The editor bundle is pinned by sha256 or built by us.
   - It is never loaded from a CDN or upstream at runtime.
   - It is reviewed on each sync, because it runs with app-origin privileges.
6. **Story 1.3 (`packages/bridge`).**
   - `render` = `ui.render` with `ids` and `scale`; no `screenshot` in the API.
   - A typed `EditorHidden` error fails fast instead of waiting 30 s.
   - Add the two-tier `onChange` detector.
   - Shortcuts are platform-mapped (Cmd on a Mac).
7. **Known risk 3 / Story 4.2.** "A closed tab ends an interactive turn" → "a closed **or hidden**
   tab pauses an interactive turn".
8. **Epic 2 patches ahead of 2.3:**
   - `revision` / undo depth in `document.inspect`;
   - a repaint request while a screenshot is pending;
   - a warning in command results when a font is unavailable.
9. **Epic 4 (agent).**
   - Start from the 0.3 `v2` prompt and tool shape.
   - Enforce scope for every scoped request (undo out-of-scope edits).
   - Make design-system fonts available to the editor, so `fontStyle` can't silently fall back.
   - Add build-a-screen golden cases with a blind side-by-side rating.
   - Re-baseline the job hand-off cases once `ask_questions` (4.4) exists.
10. **Story 3.6 (thumbnails).** Render from the saved file with headless `figcraft-cli` at a
    scale computed from the bounds, not from the user's tab.
11. **Story 0.4 text.** The timeout isn't headless-specific: hidden tabs block every call.
12. **Risks.** Add a performance budget for effects at DPR 2. Node count and load time are not a
    risk at 10–30k nodes.
