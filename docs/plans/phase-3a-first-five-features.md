# Phase 3a: the first five features (plan)

**Goal.** Build features 1 to 5 of SPEC §6a until their stories work in the real app: canvas mode
with Greenfield's own chrome, Claude as a collaborator, chat with the selection, comment or ask on
any element, and design systems Claude follows. Features 6 to 10 are out of scope.

**Gate.** Nothing starts until the `greenfield-editor` fork repo is built and verified (byte-identical
to the patch build), because every fork change in this plan lands there, not in
`spikes/0.2-fork-build`.

## What's already done

2.3 (ids-only events), 2.4, 2.11, 2.12 (fork, merged); 4.1, 4.2 (agent turns in the browser); 5.0
(spike, ADR 0005, PR #23); 5.3 (themes); 6.1 (comments live in the file). The ADR's findings bind
this plan: panels read events, never poll; a control call costs a frame until replies are instant;
the layers list patches instead of re-reading; a host gesture must cancel a stale one.

## The data shape everything shares

`packages/editor-state` (5.6) is the one store the panels read. It is fed only by bridge events and
written only through bridge commands and gestures.

```ts
interface EditorState {
  document: { id: number; revision: number; dirty: boolean } | null;
  pages: PageSummary[]; // id, name, current
  tree: Map<NodeId, TreeNode>; // id, parent, children, name, kind, visible, locked,
  // component/instance marks; patched from document.changed
  selection: NodeId[];
  nodes: Map<NodeId, NodeFields>; // full fields for selected nodes (from selection.changed)
  tool: ToolId;
  viewport: { zoom: number; x: number; y: number };
  textEditing: NodeId | null;
  agent: { name: string; active: boolean; layers: NodeId[] } | null; // 2.4 presence
}
```

Hooks: `useSelection`, `useNode(id)`, `usePageTree`, `useTool`, `useViewport`, `useAgentPresence`,
each a narrow subscription. Writes: `run(command, params)`, `batch(steps)`, and
`useGesture(label)` → `{ preview(commands), commit(), cancel() }`, which keeps at most two
previews in flight, lets the newest replace the waiting one, and cancels a stale gesture before
`edit.begin`.

## Waves and lanes

Each lane is one worktree, one branch, one PR (a lane with several stories commits each story
separately). Lanes in a wave run in parallel and touch disjoint files. Wave 2 branches from an
integration branch `phase-3a-base` = `main` + W1-A's pin bump + W1-B's store and shell.

```
gate: greenfield-editor fork verified
  │
  ├─ W1-A fork events (greenfield-editor) ──► release ──► pin bump PR in greenfield ─┐
  ├─ W1-B store + shell skeleton (5.6, 5.4, 5.13) ───────────────────────────────────┼─► phase-3a-base
  ├─ W1-C agent backend (4.3, 4.4, 4.5, 4.6, 4.7 data)                               │      │
  └─ W1-D design systems backend (10.1, 10.3, 10.4)                                  │      │
                                                                                     ▼      ▼
  W2-A layers & pages (5.7)        W2-B inspector core (5.8)      W2-C styles, variables, pickers (5.9, 5.11)
  W2-D top bar tools, context menu, floating toolbar (5.1, 5.10)  W2-E Prototype & Code tabs (5.12)
  W2-F agent pane & collaborator (5.2, 5.5, 4.7 UI, 4.4 cards, 4.5 job cards)
  W2-G comments: Ask Claude & list (6.2, 6.4)   W2-H design systems: build, follow, update (10.2, 10.5, 10.6)
```

### File ownership (the contract that keeps lanes apart)

- **W1-B owns the shell layout** (`features/shell/*`, the project page) and creates **stub files**
  that wave-2 lanes own and replace: `features/layers/layers-panel.tsx` (W2-A),
  `features/inspector/design-tab.tsx` (W2-B), `features/inspector/styles/*` and
  `features/pickers/*` (W2-C), `features/shell/tool-row.tsx`, `features/canvas-menus/*` (W2-D),
  `features/prototype/prototype-tab.tsx`, `features/code/code-tab.tsx` (W2-E),
  `features/agent/agent-pane.tsx` (W2-F), `features/comments/comments-panel.tsx` and
  `features/comments/composer.tsx` (W2-G). After wave 1, no wave-2 lane edits
  `features/shell/*` except W2-D's `tool-row.tsx`.
- **Migrations:** W1-C and W1-D may each add one; the second to merge renumbers.
- **Bridge generated types:** only W1-A's pin bump regenerates them.
- **Server services:** W1-C owns `services/agent/*`; W1-D owns `services/design-systems/*`.

## W1-A: fork events and instant replies (greenfield-editor)

- [ ] Depends on: the gate.
- [ ] Files: greenfield-editor only; then `packages/bridge/editor-release.json`, generated types and
      the bridge's event types in greenfield (pin bump PR).
- [ ] Change, first (W1-C needs it): every fork release also ships a headless `figcraft-cli`
      for Linux x86_64 (Vercel Sandbox's platform), built in CI with its sha256 in the release.
      Upstream ships only a macOS CLI; Story 0.3 built its own.
- [ ] Change: 2.3 with payloads (`selection.changed` carries the selected nodes' fields;
      `document.changed` carries changed nodes with fields plus added/removed/moved with parent
      and index), plus `tool.changed`, `text.editing`, `viewport.changed`; replies to
      `window.figcraft` calls resolve when the command ran (no 16 ms poll); canvas background and
      empty-canvas grid follow `view.themeDark` / `view.themeLight` in canvas mode (2.1). Also a
      flag or event when the canvas has its own interaction open (ADR 0005, 2.12 note).
- [ ] Result: the spike's events mode reaches the ADR's floor (Chrome ~9–10 ms, Firefox ~10–11 ms).
- [ ] Verify: fork tests per event; bridge e2e in three engines against the release; re-run the
      spike's `measure` scripts and record before/after; size gate; byte-identical double build.

## W1-B: editor-state store and shell skeleton (5.6, 5.4, 5.13)

- [ ] Depends on: the gate. Builds against ids-only events plus reads; switches to payloads when
      W1-A's pin lands (both must merge into `phase-3a-base`).
- [ ] Files: new `packages/editor-state`; `features/shell/*`; the project page; the stub files above.
- [ ] Change: the store and hooks above; the mockup's layout (left panel tabs Agent / Layers /
      Comments / Assets, canvas in canvas mode, right panel Design / Prototype / Code); F6 /
      Shift+F6 cycling and Cmd+\ (5.4); "Use editor panels" toggle (5.13) keeping selection and undo.
- [ ] Result: the project page is the mockup's frame with stub panels, the canvas in canvas mode.
- [ ] Verify: unit tests on the reducer from recorded event streams; e2e: selection on canvas
      shows in a stub panel; F6 cycle; fallback round trip keeps selection and undo depth; perf:
      a 30k-node file keeps a virtualised tree under one frame per update (baseline from ADR).

## W1-C: agent backend (4.3, 4.4, 4.5, 4.6, 4.7 data)

- [ ] Depends on: the gate.
- [ ] Files: `services/agent/*`, `packages/agent`, `packages/contracts`, `packages/sandbox-runner`,
      agent routes; a migration if jobs need one.
- [ ] Change: self-check with `ui.render` (capped retries, renders not stored); follow-up
      questions end the turn and resume with the answer; jobs ("generate", "redesign",
      "N alternatives") run headless `figcraft-cli` (the Linux build from W1-A's release, pinned
      by sha256; 4.5 starts once it exists, the other stories don't wait) in Vercel Sandbox on a copy, saved as an `agent` version, streamed, cancellable;
      sandbox confinement tests (4.6); per-turn change records (4.7) from `document.changed`.
- [ ] Result: the API runs each; UI comes in W2-F.
- [ ] Verify: unit and route tests with stubbed models; one real job end to end in a sandbox (≤ 3
      real model calls, report cost); confinement tests prove both rules.

## W1-D: design systems backend (10.1, 10.3, 10.4)

- [ ] Depends on: the gate.
- [ ] Files: `packages/db/src/schema/design-systems.ts`, `services/design-systems/*`, settings pages
      under `settings/design-systems`, `packages/authz` (publish and set-default permissions).
- [ ] Change: tables for systems and versions (library file + guide); a review page (keep or drop
      each colour group, type style, component) over a library file; publish and default, with
      admin-limited permissions; new files attach the default.
- [ ] Result: an admin publishes a hand-made library file as the default; a new file starts with it.
- [ ] Verify: service tests (workspace scoping, authz); e2e of review → publish → new file.

## Wave 2 (after `phase-3a-base`)

Each lane: its stories, the files it owns above, unit tests, a live e2e through the real canvas in
Chromium plus a WebKit and Firefox pass, and the perf box where it changes an interaction.

- **W2-A 5.7 Layers and pages.** Virtualised tree patched from events; rename, drag reorder, lock,
  hide, multi-select; component and instance marks. Perf: 30k-node update under one frame.
- **W2-B 5.8 Inspector core.** All of 5.8 with scrubbing through `useGesture`. Perf: scrub →
  canvas repaint and canvas click → inspector, against ADR 0005's numbers.
- **W2-C 5.9 + 5.11.** Instance properties and variants, styles, variable binding and modes;
  colour picker with variables and styles, font picker (design system fonts first), export panel.
- **W2-D 5.1 + 5.10.** Tool row with the active tool from events; our context menu from
  `ui.request contextMenu`; floating toolbar when the edit panel is hidden.
- **W2-E 5.12.** Prototype tab (`proto.*`), Code tab (generated code for the selection).
- **W2-F 5.2 + 5.5 + 4.7 UI + 4.4 cards + 4.5 job cards.** The agent pane of the mockup: streaming
  chat, selection chip, change list with "Show on canvas" and "Undo all", follow-up cards, job
  cards; Claude's avatar ringed in ember during a turn; "changed by Claude · Revert" in the inspector
  (a hook W2-B renders).
- **W2-G 6.2 + 6.4.** Composer positioned at the element from `ui.request comment.new`; Comment
  or Ask Claude; `comment.prompt` context; Comments panel with open/resolved, jump, reply, Ask.
- **W2-H 10.2 + 10.5 + 10.6.** Build a system from a GitHub repo, uploads or a `.fig` (a 4.5 job);
  the guide and a summary in the agent's cached prefix; a deterministic check for raw colours
  and off-scale spacing after each turn; library updates with a review.

## Done means

Every story above meets its SPEC AC in the running app; `pnpm lint && pnpm typecheck && pnpm test`,
the app and editor e2e suites and the bridge suite pass; the mockup and the app side by side in
dark and light. Interaction-changing PRs wait for the operator's review before merge.

## Unproven going in

- Instant replies (W1-A) are a guess at the fork's polling loop; the ADR measured the cost, not the fix.
- 4.5 assumes the fork's Linux `figcraft-cli` runs headless in Vercel Sandbox (upstream ships
  only a macOS CLI, checked).
- 10.2's "typical Tailwind repo → variables and components" quality is unmeasured.
- A 30k-node file has never been opened in canvas mode.
