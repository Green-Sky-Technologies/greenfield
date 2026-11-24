# Story 0.1 spike: embed FigCraft in Next.js (findings)

Release figcraft-web v0.18.1. The spike is dev-only (`CRUNCH_FIGCRAFT_SPIKE=1` and `NODE_ENV !== 'production'`).

## Result

All four AC items pass in Chromium, WebKit and Firefox (headless Playwright on a macOS host, 3 runs each).

- Storage tested: the local-fs fallback (`apps/web/.data/blob/`), because no `BLOB_READ_WRITE_TOKEN` is set
  locally. The Vercel Blob implementation (private access, `allowOverwrite`) type-checks but was never run.
- Auth: real Clerk sign-in, reusing the setup/teardown in `e2e/app/global.setup.ts`.
- Authorization: reads go through `getProject` (`project:read`, workspace-scoped; another workspace gives
  `NotFoundError`). Saves call `assertCan('design:edit')` and refuse archived projects. No new permission.
- Storage key: `figcraft-spike/<ws>/<project>/document.figcraft`.
- Message checks: the host accepts a message only when `event.origin === location.origin` and
  `event.source === iframe.contentWindow`. The iframe `src` is set only after the listener is attached,
  because `ready` is posted once. Bytes are never logged.

## Numbers

Zip: 10,534,024 B, sha256 `2fbeb93f5022b0a7cc9d8528f1ed7e2b54c94d213ef79e65128aa898c399f02b`.

| File | Raw | gzip -9 | Brotli q11 | `next start` gzip |
|---|---|---|---|---|
| Wasm | 25,503,950 B (24.3 MiB) | 10,387,605 B | 7,375,665 B | 10,498,942 B |
| JS | 187,658 B | | | |

Timings: localhost `next dev`, a fresh context per test. "Cold ready" is iframe `src` set → `ready`
received, for runs 1 / 2 / 3; run 3 was on a loaded machine.

| Browser | Cold ready | Warm reload | Save → stored (host PUT) | Reopen |
|---|---|---|---|---|
| Chromium | 568 / 666 / 2474 ms | 499–1377 ms | 188–587 ms (89–450 ms) | 73–309 ms |
| WebKit | 680 / 750 / 2273 ms | 646–2262 ms | 57–192 ms (19–88 ms) | 25–376 ms |
| Firefox | 650 / 628 / 2744 ms | 628–2021 ms | 50–273 ms (20–149 ms) | 24–89 ms |

- Renderer: runs 1 and 3 forced `?webgl` (WebGL2), run 2 used the default renderer; all passed. Pixels
  were not checked.
- Saved documents were 2,046–3,526 B.

## Per-browser failures

1. **WebKit: `no shortcut \`S\``.** Save is Cmd+S when the browser reports a Mac.
   `ui.key {key:'S', cmd:true}` gives `file.save`; `command`, `meta` and `mac_cmd` give `tool.slice`.
   The spec tries ctrl first, then cmd.
2. **WebKit: Clerk FAPI page errors** ("…_clerk_retry_attempt=1 due to access control checks."), 2–3 per run.
   They come from Clerk, not the editor. The spec filters exactly that pattern and records the count; any
   other page error still fails the test.

No failures in Chromium or Firefox.

## Serving

- Next already serves `.wasm` as `application/wasm`, and `next start` gzips it.
- Cache headers added in `next.config` (verified with curl on dev and start): `immutable` on
  `/editor/*.wasm|js`, `no-cache` on `index.html`, `nosniff` on `/editor/*`. Without them Next's
  `public/` default is `max-age=0`.
- No COOP/COEP needed: upstream `HOSTING.md` says the build doesn't use SharedArrayBuffer, and the glue
  has no reference to it.
- Use `/editor/index.html?...` as the iframe URL; bare `/editor/` was not tested.
- Clerk proxy: `wasm` added to the matcher's static-file exclusions.
- Production with the flag set: the API returns 404; the page redirects to sign-in first (the workspace
  layout runs before the flag check).

## Protocol

- **Saves have no `id`.** The first Save of a new document has `saveAs: true` and name
  `Untitled.figcraft`; later saves have `saveAs: false` and the host's name. With no `id`, dirty clears as
  soon as the save is posted, before the host stores it. The host already answers `figcraft:saved {id}`
  when an `id` is present.
- Host mode starts on the home screen. With nothing stored, the test calls `file.new` itself.
- `ready` fires only once.
- `window.figcraft` exposes request, execute, commands, docInspect, uiInspect, screenshot, inspect,
  openFile, captureDownloads, files and readFile; 643 commands.

## Proposed SPEC.md changes

1. **Story 0.2 size target.** 0.18.1 is already over "<24 MiB raw" and ~0.7 MiB under Cloudflare's
   25 MiB limit; upstream `HOSTING.md` still says 18 MiB. Restate the target and add a CI size check.
2. **Save acknowledgement.** Require a save `id` and clear dirty only on `figcraft:saved` (Story 2.3 or
   a fork patch). Today a failed upload is silent data loss.
3. **Upload path.** Vercel's 4.5 MB function body limit means saves should use client uploads to
   private Blob, with a `handleUpload` route that checks auth.
4. **Trust boundary.** Same-origin host mode gives the editor app-origin access, including Clerk's
   non-HttpOnly `__session` cookie and every API. The bundle must be pinned by sha256 or built by us,
   never loaded from a CDN/upstream at runtime, and reviewed on every sync.
5. **Shortcuts** are platform-mapped; the Story 1.3 Playwright helper must not hard-code Ctrl.
6. **Story 1.2 AC:** add caching and compression.

## Reproduce

```sh
pnpm install
docker compose -p crunchdesign up -d db
DATABASE_URL=postgres://crunch:crunch@localhost:5433/crunch pnpm db:migrate
node spikes/0.1-embed/fetch-editor.mjs
cd apps/web
pnpm exec vitest run test/figcraft-spike.test.ts
pnpm exec playwright test -c e2e/figcraft-spike/playwright.config.ts   # next dev :3101
FIGCRAFT_WEBGPU=1 pnpm exec playwright test -c e2e/figcraft-spike/playwright.config.ts
```

Manual: `CRUNCH_FIGCRAFT_SPIKE=1 pnpm exec next dev --port 3101`, then open
`/w/<slug>/p/<id>/figcraft` (add `?webgl` to force WebGL2).
