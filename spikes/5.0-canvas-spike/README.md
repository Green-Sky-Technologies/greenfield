# Story 5.0: canvas-mode spike

Measurement scripts for [ADR 0005](../../docs/adr/0005-canvas-mode.md). The page they drive is
`apps/web/src/app/dev/canvas-spike` (throwaway; Story 5.6 replaces it).

```sh
# 1. Put a fork build in apps/web/public/editor/ (the dist from spikes/0.2-fork-build/verify/docker-build.sh).
# 2. The editor's CSP hashes its index.html when the app builds, so rebuild after swapping the editor.
cd apps/web && CANVAS_SPIKE=1 pnpm exec next build && CANVAS_SPIKE=1 pnpm exec next start --port 3350

# 3. From the repo root (needs the Playwright browsers; Chrome with a GPU needs --channel chrome --headed 1):
node spikes/5.0-canvas-spike/run-matrix.mjs --build <label> --canvas flag --trials 20 \
  --browsers chromium --channel chrome --headed 1 --files small,large,stress --syncs events,pointer
node spikes/5.0-canvas-spike/summarize.mjs <label>      # Markdown tables from results/
node spikes/5.0-canvas-spike/probe.mjs <shots-dir> --browser firefox   # presence, ui.request, events, screenshots
node spikes/5.0-canvas-spike/timeline.mjs --file large  # raw timeline of a few clicks
```

`measure.mjs` waits for the machine to be 75% idle (a Docker build wrecks the numbers) and records idle
at the start and end of each run. `results/` holds the runs in the ADR.
