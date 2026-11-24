# Spikes (Epic 0)

Throwaway proof-of-concept code for the go / no-go gate. The findings live in each spike's
`FINDINGS.md` and in [`docs/adr/0003-figcraft-embed.md`](../docs/adr/0003-figcraft-embed.md).

The spikes are kept as history and are no longer part of the pnpm workspace. They were last
runnable at the Phase 0 merge commit `ef05c3b`: Story 1.2 removed the HTML-model packages that
`0.3-agent` imports, and promoted the `0.1-embed` editor (its `fetch-editor.mjs` now lives in
`apps/web/scripts/`). To run one, check out `ef05c3b`.

| Spike                                          | What it answered                                     |
| ---------------------------------------------- | ---------------------------------------------------- |
| [`0.1-embed`](0.1-embed/FINDINGS.md)           | FigCraft embedded in the Next.js app, saving to Blob |
| [`0.2-fork-build`](0.2-fork-build/FINDINGS.md) | Building `figcraft-web` from source in CI            |
| [`0.3-agent`](0.3-agent/FINDINGS.md)           | Can Claude draw with FigCraft commands?              |
| [`0.4-browser`](0.4-browser/FINDINGS.md)       | Real-browser pixels, change detection, large files   |
