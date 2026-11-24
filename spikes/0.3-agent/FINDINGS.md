# Story 0.3 spike: can Claude draw? (findings)

**Verdict: comparable to the HTML-frame agent, and not clearly worse on anything we tested.**
With the `v2` system prompt, FigCraft commands match the current agent on the golden edits and
on two build-a-screen prompts. FigCraft costs about half as much per small edit and about the
same per built section. The gate in SPEC §9 D19 is passed.

Model `claude-sonnet-5-5` (MODEL_TIERS.interactive) through the Vercel AI Gateway via
`packages/providers`, same model and request shape for both arms. Estimated total spend for
every run in this spike: **$4.59**.

## Best variant: `v2`, repeated 3 times (`out-var/r1..r3`)

Costs are means per run, estimated from token counts at Sonnet 5.5 prices.

| Case | FigCraft `v2` pass | FigCraft cost | HTML pass | HTML cost |
|---|---|---|---|---|
| headline-copy | 3/3 | $0.007 | 3/3 | $0.013 |
| button-larger-scoped | 3/3 | $0.006 | 3/3 | $0.016 |
| feature-cards-spacing | 3/3 | $0.012 | 3/3 | $0.021 |
| density-slider | 2/3 ¹ | $0.027 | 3/3 | $0.033 |
| pricing-page-offers-job | 3/3 | $0.007 | 0/3 ² | $0.012 |
| alternatives-offers-job | 3/3 | $0.008 | 0/3 ² | $0.011 |
| *extra* x-build-pricing | 3/3 ³ | $0.158 | 3/3 | $0.124 |
| *extra* x-build-testimonials | 3/3 | $0.089 | 3/3 | $0.088 |

1. FigCraft has no slider tool (sliders are dropped in the new SPEC, D16), so it draws a
   segmented control. Once out of three it put that control just outside the scoped section.
2. The HTML agent calls `ask_questions` first ("I'll ask a few quick questions…") instead of
   offering a job. That is the current agent's real behaviour, not a harness bug, and the FigCraft
   arm has no `ask_questions` tool. These cases are not evidence about drawing.
3. "Pass" on the extra cases only means no job was offered. Quality was judged by eye from the
   renders; see below.

Wall time: FigCraft edits take 3–6 s versus 2–6 s for HTML. Builds take 34–53 s versus 24–48 s,
because FigCraft uses more turns (6–10 versus 3–5): it renders, fixes, and renders again.

## Quality, judged by eye

The side-by-side renders are in `out/REPORT.md` (`out/<variant>/<case>/{figcraft,html}.png`).

- **Small edits:** indistinguishable from the HTML arm.
- **Testimonials:** a tie; FigCraft is slightly tighter.
- **Pricing + FAQ:** `v1` was clearly worse than HTML. Headings and prices rendered Regular,
  and the cards had ragged heights with CTAs at different positions. `v2` fixed both: Bold
  headings, equal-height cards with bottom-aligned CTAs, and an FAQ with dividers or cards. That
  is on par with or better than the HTML arm, whose FAQ had stray borders.

This judgement is mine and not blind. Only two build prompts were run, on one fixture.

## Variants tried (golden set; the extra cases ran on `v1` and `v2` only)

| Variant | What changes | Golden pass | Cost for 6 cases (one cold run) | Notes |
|---|---|---|---|---|
| HTML frame | current agent, for reference | 4/6 | $0.32 | both failures are `ask_questions` instead of a job |
| `v1` | base prompt, `batch` + `get_node` + `list_commands` + `render`, subtree context | 5/6 | $0.15 | failed both builds visually (fonts, card rows) |
| `v1-auto-render` | a render attached after every edit | 5/6 | $0.13 | no quality gain on edits |
| `v1-no-render` | no pixels | 5/6 | $0.10 | fine for edits; the build bugs above are only visible in pixels |
| `run-command` | one command per call, no batch | 6/6 | $0.14 | more turns; each step is its own undo step (bad for UX) |
| `curated` | batch limited to 12 documented commands | 5/6 | $0.11 | cheapest; no loss |
| `full-catalog` | all 645 commands in the prompt (~30k tokens) | 5/6 | $0.53 | 5× the cost, no gain |
| `minimal` | short prompt, outline-only context | 5/6 | $0.29 | more turns spent reading the document |
| **`v2`** | `v1` + `<craft>` rules (see `src/figcraft/prompt.ts`) | 6/6 | $0.16 | fixed the build-quality failures |

The `<craft>` rules in `v2`:
- Always set `fontFamily` along with `fontStyle`, and check weights in the render.
- Copy the existing section padding, heading weight and card style; read a sibling first.
- For card rows, use `sizingV: fill` cards and a spacer to push CTAs to the bottom.
- Buttons are auto-layout frames.
- Build one batch, render, then fix in a second batch.

Recommended tool shape: `batch` (one undo step per edit), `get_node`, `render` and
`suggest_generation_job`, with the curated command reference in the prompt. Don't include the
full catalog. Rendering on request is enough; there's no need to attach a render after every
edit.

## Failure modes found

1. **Silent font fallback (important).** `node.create` without `fontFamily` defaults to Inter. If
   Inter isn't available, the text renders in a Regular fallback, while `inspect` still reports
   `fontStyle: "Bold"`. Only the pixels show the problem. This is partly an environment
   artifact: Inter isn't installed here, and our fork build leaves out `storytold/craft-fonts`.
   Even so, the editor should report missing fonts to the agent.
2. **Layout idioms.** Equal-height card rows and bottom-pinned buttons need explicit
   `sizingV: fill` plus a spacer. The model doesn't do this by default; it does once prompted.
3. **Scope.** When a scoped request "needs" a new control, it sometimes lands next to the scope
   instead of inside it. The harness undoes out-of-scope edits on `button-larger-scoped`. The
   scope rule should be enforced the same way for every scoped request.

## Caveats

- One fixture (`landing`), recreated in FigCraft with gaps: literal tokens, no component
  instances, desktop only. See `out/REPORT.md` → Method.
- FigCraft renders come from `figcraft-cli`'s `screenshot` (CPU renderer); `ui.render` is
  browser-only. Story 0.4 found `ui.render` reliable in the browser.
- The HTML arm also has `create_slider` and `ask_questions`, so those cases aren't comparable.

## Recommended follow-ups

- Fork patch: on `node.create` / `node.set` / `text.style` with an unavailable font, return a
  warning in the command result. Alternatively, bundle the design system's fonts and let
  `fontFamily` default to the design system font.
- Keep the `v2` craft rules in the Epic 4 system prompt. Turn the two extra prompts plus a
  few more build prompts into golden cases with a blind side-by-side rating.
- Add `ask_questions` to the FigCraft tool set (Story 4.4) and rebaseline the job hand-off cases.

## Reproduce

```sh
# VERCEL_OIDC_TOKEN (or AI_GATEWAY_API_KEY / ANTHROPIC_API_KEY) in the environment
# FIGCRAFT_CLI=<path to figcraft-cli> if not built at spikes/0.3-agent/figcraft/target/release
pnpm --filter spike-0.3-agent eval -- --variant v2 --parallel 4                # golden set
SPIKE_EXTRA=1 pnpm --filter spike-0.3-agent eval -- --variant v2 --parallel 4  # + build cases
pnpm --filter spike-0.3-agent eval -- --scripted                               # no network
```
