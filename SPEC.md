# Project: Greenfield — open design tool with an agent

> **Handoff brief for Claude Code.** Greenfield (formerly CrunchDesign) is a web design tool:
> a real vector editor with an agent built in. The editor is a fork of
> [FigCraft](https://github.com/storytold/figcraft) (Rust, compiled to WebAssembly) embedded in
> our Next.js app. The app adds workspaces, the agent, comments that can be sent to the agent,
> storage, versions and sharing. In **canvas mode** the editor draws only the canvas; every
> toolbar, panel and menu around it is Greenfield's own React (§9 D28).
>
> Written as epics and user stories with acceptance criteria (AC). The plan is built for
> **parallel work**: after a short serial foundation, epics 2 to 9 are lanes that one person or
> one Claude Code session can each take at the same time. Decisions are logged in §9.
>
> **Status (2026-11-24):** Phase 0 passed the gate (go, ADR 0003), Phase 1 is merged, and
> Phase 2 lanes are under way. **Change of direction:** the editor moves to canvas mode with our
> own chrome (D28), and §6a sets the ten features Greenfield must have, taken from standalone
> Claude Design. Next: the canvas-mode spike (Story 5.0), which gates Epic 5.

---

## 0. Context & Purpose

**Core loop:** draw it yourself (canvas, tools, inspector) **or ask** (agent pane, or a comment
sent to the agent) → review what the agent changed → share or export.

**Three principles for the product:**
1. **Direct control is the default.** The canvas works like a professional design tool: select,
   drag and type on it at any time. The agent is a pane and a comment action, not the whole app.
2. **Claude is a collaborator on the canvas.** It appears like another person in the file: its
   avatar in the top bar, an ember outline and name tag on the layers it is editing, and its edits
   listed and undoable. You can work alongside it while it works.
3. **You can always tell your edits from the agent's.** Green marks you (selection, focus,
   primary actions); ember marks the agent (what it is editing, values it changed, its turn).

**Baseline:** standalone Claude Design (claude.ai/design, closing 2026-12-14) is the bar for the
AI workflow. Everything it does should work its way into Greenfield; §6a picks the ten that
come first, and the appendix lists the rest.

**Brand:** "Greenfield — Design in the open." A Green Sky product, in the same family as the
greensky.tech site: square corners, hairlines instead of cards, a 32-unit pixel mark. Brand
sheet and editor mockups: the "Greenfield brand and editor" design canvas.

**Non-goal:** cloning any product's visual identity. FigCraft's own name and logos are
trademarks of the ArtCraft Team and must not appear in Greenfield (see Epic 8).

**Out of scope for v1** (see §8): real-time multiplayer between people, accounts across
Greenfield servers, billing, mobile, two-way Figma sync, live-code frames (HTML, shaders, video).

---

## 1. Target Stack

| Layer | Choice | Notes |
|---|---|---|
| App shell | **Next.js (React + TS)** on **Vercel** | All chrome: top bar and tools, agent pane, layers and pages, inspector, context menus, pickers, comments, workspaces, settings. |
| Editor | **FigCraft fork** (`figcraft-web`, Rust → WebAssembly, egui on WebGPU/WebGL2) | Embedded in a same-origin `<iframe>` in host mode and **canvas mode** (Story 2.11): it draws the canvas, selection handles, in-place text editing, agent presence and comment pins, and nothing else. |
| Bridge | **`packages/bridge`** | Typed client for `window.figcraft` (commands, `document.inspect`, `node.get`, `ui.render`), the host messages (`figcraft:ready/open/save/dirty`) and the editor's events (2.3). Feeds `packages/editor-state`, the React store every panel reads. The only way app code talks to the editor. |
| Document | **`.figcraft` archive** | Source of truth. Stored in Vercel Blob; Postgres holds metadata, versions and permissions. |
| App auth | **Clerk** (Organizations = Workspaces) | Admin / Editor / Viewer. Unchanged. |
| Database | **Neon Postgres** + **Drizzle** | Unchanged; HTML-model tables removed (Story 1.2). |
| Interactive agent | **Messages API + tool use** in Vercel Functions, **tools executed in the browser** | The document lives in the user's iframe, so tool calls stream to the client, run through the bridge, and results post back (Story 4.2). |
| Long-running agent | **Claude Agent SDK** in **Vercel Sandbox** with headless **`figcraft-cli`** | Works on a copy of the file; the result comes back as a new version (Story 4.5). |
| Model access | **Vercel AI Gateway by default, optional workspace BYOK; Claude only** | Unchanged (§3). |
| Collaboration | **Soft edit lock** + comments | FigCraft's live sessions are a preview upstream; adopt later (§8). |
| Monorepo | **pnpm + Turborepo** (TS), **Cargo** (fork) | The fork lives in its own repository, built in CI into a static bundle the app serves. |

### Architecture shape
```
Browser
 ├── Next.js shell (React): top bar + tools · agent pane · layers · inspector · menus · comments
 │      │  editor-state store ◄── events (selection, document, tool)
 │      │  bridge (commands, gestures, queries; same origin)
 │      ▼
 └── <iframe /editor/?host=parent&control&canvas>  Greenfield editor (FigCraft fork, WASM)
            canvas only: drawing · handles · text editing · Claude's presence · comment pins
   │ REST / Server Actions          SSE (agent turns, tool calls, job events)
   ▼
Vercel Functions (Node/TS)
   ├── Clerk auth, workspace/role checks
   ├── Projects · files · versions · share links           → Neon Postgres
   ├── .figcraft files, images, exports                    → Vercel Blob
   ├── Interactive agent (Messages API; tools run in the browser)
   ├── LLM proxy (key injection, metering)  ◄── all model calls
   └── Job API ──► Vercel Sandbox: Agent SDK + figcraft-cli (headless) on a file copy
```

### Known risks (read before starting)
1. **Agent quality with drawing commands.** The agent issues editor commands instead of writing
   HTML. Passed the 0.3 gate: with the right prompt it matched the HTML agent (ADR 0003). Watch
   three failure modes: fonts that silently fall back, layout idioms the prompt must teach, and
   edits that land just outside the scope. → Stories 4.1–4.3, 4.8.
2. **Fork maintenance.** FigCraft moves fast (alpha). Keep our patches small and upstream what
   we can. → Epic 2.
3. **Agent edits during the user's session.** Tool calls run in the user's browser, so a closed
   **or hidden** tab pauses an interactive turn: the editor draws no frames in a background tab,
   and every bridge call waits for one. Long work goes to jobs. → Stories 4.2, 4.5.
4. **No change events in the browser build.** Today the host only gets a dirty flag. Until 2.3,
   the bridge polls a cheap `document.inspect` and diffs only when it changes (0.4). → Story 2.3.
5. **Bundle size.** The WebAssembly file is 24.3–24.4 MiB raw with fonts (22.7 MiB without),
   7.0–7.4 MiB Brotli. Upstream fails a build over 25 MiB, so headroom is under 1 MiB.
   → Stories 2.9, 8.2.
6. **Licences.** FigCraft is MIT or Apache-2.0; Greenfield is AGPL-3.0. Confirm the combination
   with someone qualified. → Story 8.4.
7. **The editor runs with the app's privileges.** Same-origin host mode gives the editor bundle
   access to the app origin, including Clerk's readable session cookie and every API. → Story 8.1.
8. **Effects-heavy files.** Heavy effects at device pixel ratio 2 pan slowly (p95 92 ms in Chrome,
   350 ms in Firefox); node count is not a risk (30k nodes open in under 0.5 s). → Story 8.2.
9. **Canvas mode is a lot of interface.** Every panel FigCraft drew is now ours to build. Story
   5.0 proves the risky parts first (events, one-step scrubbing, speed); Story 5.13 keeps the
   editor's own panels reachable as a fallback while ours catch up.
10. Carried over: credential exposure in sandboxes (Story 4.6), prompt-cache TTL, Vercel Hobby
   being non-commercial.

---

## 2. Cost Architecture

**These are design constraints.** Users pay model costs through their own keys or the
deployment's gateway, so wasting tokens is a product defect.

1. **Canvas work never calls the model.** Drawing, editing and inspector changes happen in the
   editor. Zero tokens.
2. **Stable cacheable prefix.** System prompt, tool definitions and the command catalogue are
   serialized deterministically and marked for prompt caching.
3. **Surgical edits.** The agent reads the selection's subtree (`node.get`) plus a compact
   outline of the page, and changes it with one `batch` of commands, which is one undo step. It
   never re-reads or re-creates the whole document for a local change.
4. **Full generation is rare and user-initiated** ("design a pricing page", "three
   alternatives"), and runs as a job.
5. **Export happens on demand.**
6. **Tiered model defaults**, user-overridable (Story 4.9).

Measure everything (Story 4.10). Check current model pricing in Anthropic's docs; do not
hard-code prices from this spec.

---

## 3. Auth & Credentials Model

Unchanged from CrunchDesign; already built. Summary:

- **Clerk** Organizations = Greenfield **Workspaces**. Roles: **Admin** (members, credentials),
  **Editor** (edit, comment, run the agent), **Viewer** (view only; can open share links and
  run exports that use no model).
- **Model access:** the deployment's Vercel AI Gateway by default (`GREENFIELD_AI_GATEWAY=on|off`
  overrides), with optional workspace BYOK: Anthropic API, Amazon Bedrock (role assumption
  preferred), Google Vertex AI, Azure AI Foundry, or an AI Gateway key. Precedence: a tested
  workspace credential → the deployment gateway → any other saved credential → none.
- Credentials use **envelope encryption** (AES-256-GCM, AAD = workspace id); never logged,
  never sent to the browser, never placed in a sandbox (the LLM proxy injects them).
- **No spend caps during beta;** usage is metered per member and workspace.
- **Policy:** claude.ai login and Free/Pro/Max OAuth tokens are never accepted.
- **Billing:** none in v1 (free beta).

---

## 4. Interaction Model

See the Editor page of the design canvas and `docs/brand/mockups/editor.png`: that mockup is the
target layout.

**Layout:**
- **Top bar:** project and file, the tools (move, frame, shapes, pen, text, hand, comment), "Comment
  or ask", the people row with Claude's avatar, zoom, Present, Share.
- **Left panel:** Agent, Layers and Assets tabs.
- **Canvas:** the editor in canvas mode. All direct manipulation happens here: select, drag,
  resize, edit text in place, draw with the pen.
- **Right panel (the edit panel):** Design, Prototype and Code tabs for the selection. Cmd+\
  hides and shows it; with it hidden, a small toolbar floats over the selection, as in Claude
  Design.

**No hidden modes.** The canvas is always live: selecting and dragging never needs a mode
switch, and the edit panel only changes what is shown beside it. Viewers and archived projects
open read-only: the canvas selects and inspects but never changes, and edit controls are hidden.

**Claude on the canvas:**
- While a turn runs, Claude's avatar in the top bar is ringed in ember, and the layers it is
  editing carry an ember outline with a "Claude" tag (FigCraft's agent presence, Story 2.4).
- You can keep working while Claude works. Its edits are each one undo step in your history,
  labelled as Claude's.
- **Agent pane:** a message is sent with the current selection attached (shown as a chip). The
  reply lists what changed, layer by layer, with "Show on canvas" and "Undo all".
- **Comment or ask (C):** click an element and write. **Comment** leaves a thread for people;
  **Ask Claude** sends the text to the agent pane with that element attached.
- **Follow-up questions:** before a new design, or for ambiguous or large requests, the agent
  asks in a card (multiple choice, free text, or "You decide"). Small tweaks run without asking.
- **Tweaks:** Claude can add sliders and toggles for a design (density, accent, corner style)
  bound to variables or properties; moving them costs no tokens (Epic 11).

**Attribution:** inspector values the agent changed show an ember marker and "changed by
Claude · Revert".

**Concurrency:** async teams with a **soft lock**. One Editor holds the edit lock per file;
others view and comment and can request control. The agent acts only for the lock holder.

---

## 5. Data Model (sketch)

```ts
// Postgres (packages/db)
projects       { id, workspaceId, name, archivedAt, … }                    // kept
files          { id, projectId, name, blobKey, size, sha256, updatedBy, updatedAt }
file_versions  { id, fileId, blobKey, kind: 'auto' | 'agent' | 'named', name?, createdBy, createdAt }
edit_locks     { fileId, holderId, expiresAt }                             // kept
share_links    { id, fileId, public, expiresAt, revokedAt }                // kept
comment_index  { fileId, threadId, nodeId?, authorId, resolved, updatedAt } // mirror for notifications
agent_conversations, agent_messages, jobs, job_events, llm_calls            // kept
workspaces, members, provider_credentials                                    // kept
```

- **The `.figcraft` file is the document.** Comments live in the file (FigCraft's `comment.*`
  commands, anchored to node ids); `comment_index` mirrors them for notifications and search.
- **Removed** with the HTML model (Story 1.2): `design_docs`, `doc_ops`, `doc_versions`,
  `design_systems`, `design_system_versions`, and the slider tables. Design systems come back
  in Epic 10 as `.figcraft` library files (variables, styles, components) plus a guide, with new
  tables; tweaks live in the file (Epic 11).
- **Agent tools** are command batches: `{ label, commands: [{ command, params, as? }] }`, run with
  the editor's `batch` (one undo step). Later steps refer to earlier results with
  `{"$ref": name}` or `{"$step": n}` (Story 1.4).
- **Today (after Story 1.2)** each project has one file, stored at
  `design-files/<workspace>/<project>/document.figcraft` through `services/design-files`. The
  `files` and `file_versions` tables arrive with Stories 3.1 and 3.3. The `assets` table is kept
  but unused.

---

## 6. Epics & Stories

### Lanes and order

```
Phase 0  POC          0.1 ─┐
                      0.2 ─┼─► gate ─► Phase 1 (serial) ─► Phase 2 lanes, in parallel
                      0.3 ─┤          1.1 → 1.2 → 1.3 + 1.4      2 Fork (Rust)
                      0.4 ─┘                                     3 Files & versions
Lane 9 (brand) runs from day one                                 4 Agent
                                                                 5 Greenfield chrome (canvas mode)
                                                                 6 Comments & Ask Claude
                                                                 7 Export
                                                                 8 Ops & security
Phase 3 (§6a): 5.0 spike gates Epic 5; 10–13 run alongside      10 Design systems
                                                                 11 Tweaks · 12 Context
                                                                 13 Prototype & present
```

**Why the lanes can run in parallel:** every TypeScript lane builds against FigCraft's
**unmodified upstream release** (0.18.1 at the time of writing) through `packages/bridge`. The
fork (Epic 2) only adds polish and events; nothing functional waits on it. Where a story needs
the fork, it says so and names the fallback.

| Lane | Starts after | Needs from other lanes |
|---|---|---|
| 2 Fork | 0.2 | none |
| 3 Files & versions | 1.3 | none |
| 4 Agent | 0.3, 1.3, 1.4 | none (attribution outlines arrive with 2.4) |
| 5 Editor shell | 1.3 | 2.4 for ember outlines; until then, agent edits show only in chat |
| 6 Comments & Ask Claude | 1.3 | 2.5 for the "Ask Claude" button in the editor's composer, or the 6.2 overlay fallback |
| 7 Export | 1.3 | none |
| 8 Ops & security | 0.1 | none |
| 9 Brand & launch | now | none |
| 10 Design systems | 1.3 | 4.1 for the agent prefix (10.5) |
| 11 Tweaks | 2.12, 5.8 | none |
| 12 Context | 4.2 | none |
| 13 Prototype & present | 5.0 | 7.5 for deck export |

### Carried over from CrunchDesign (built, kept)

Workspaces and Clerk roles (old 1.3), provider credentials and encryption (old 1.4), the spend
cap hook (old 1.5), projects (old 1.6, minus design-system linking), the job runner (old 5.1),
the LLM proxy (old 5.2), the model picker (old 5.9), usage metering (old 5.10), the cache TTL
strategy (old 5.11, ADR 0002), the one-click Vercel setup (old 1.2), and the signed-in e2e suite.
These are not re-specified; stories below say where they change.

---

## 6a. The ten features that come first

Standalone Claude Design is the baseline (appendix A lists everything it does). These ten come
first, in order. Each names the stories that deliver it.

| # | Feature | What "done" looks like | Stories |
|---|---|---|---|
| 1 | **Canvas mode with Greenfield's own chrome** | The editor draws only the canvas; our top bar tools, layers, inspector, context menu and pickers do the rest, matching the mockup | 2.11, 2.12, 2.3, 5.0–5.13 |
| 2 | **Claude as a collaborator on the canvas** | Avatar in the people row, ember outline and name on the layers it edits for the whole turn, its edits listed and undoable, work alongside it | 2.4, 4.2, 4.7, 5.5 |
| 3 | **Chat with the selection** | The agent pane: selection as context, follow-up questions, "show me 2–3 alternatives", explain or review a design | 4.1–4.5, 5.2 |
| 4 | **Comment or ask on any element** | Click anything, write, then Comment (for people) or Ask Claude (scoped turn); a comments list | 6.1, 6.2, 6.4 |
| 5 | **Design systems Claude follows** | Build one from a codebase, Figma file or uploads; review it; publish one as the workspace default; Claude uses its variables, styles and components and checks its own output against it | Epic 10 |
| 6 | **Tweaks** | Claude adds sliders and toggles bound to variables or properties; moving them is live, one undo step, zero tokens | Epic 11 |
| 7 | **Bring your context** | Screenshots and images, PDFs and documents, `.fig` files, a web page capture, a linked repository | Epic 12 |
| 8 | **Prototype and present** | Link frames, play the prototype; a slide-deck project type and present mode | Epic 13 |
| 9 | **Share and keep versions** | View, comment or edit access by link; autosave; named versions and "undo the AI" | 3.2–3.5, 3.8 |
| 10 | **Export and hand off** | PNG, SVG, PDF, PPTX and HTML; a handoff bundle for Claude Code; an MCP server so Claude Code can read and edit Greenfield files | 7.1, 7.5–7.7 |

Not in the ten (see appendix A): drawing on the canvas as instructions to Claude, project types
beyond designs and decks, templates and examples, group chat with Claude, voice input, Send-to
integrations, mobile. Their stories are in `ROADMAP.md` (Epics 14–22).

---

### Epic 0 — Proof of concept (go / no-go)
**Done (2026-11-24): go.** Results, numbers and the 0.3 comparison are in
`docs/adr/0003-figcraft-embed.md`; spike code is under `spikes/` (last runnable at `ef05c3b`).
Notes against the stories below:
- **0.2:** the size AC as written can't be met with fonts. Our build is 22.7 MiB without
  craft-fonts and 24.39 MiB with them; the target is now 25 MiB (Story 2.9).
- **0.4:** the screenshot timeout isn't specific to headless Chromium. A hidden tab stalls every
  bridge call, and `ui.screenshot` can miss a repaint. `ui.render` is reliable.

*Demo: inside the Next.js app, the agent builds a screen in the embedded editor from a prompt;
the file saves to Blob and reopens.* The four spikes run in parallel. Spike code is throwaway;
findings go in `docs/adr/0003-figcraft-embed.md`.

- **0.1 Embed in Next.js.** Serve the upstream `figcraft-web` release from the app's own origin
  (`/editor/`), load it in an `<iframe>` with `?host=parent&control&author=<name>`, and wire
  `figcraft:open`, `figcraft:save` and `figcraft:dirty` to Blob. AC: open a file from Blob, edit,
  Save sends the bytes to the host and they land in Blob; reopening shows the same document;
  dirty state reaches the host; works in Chrome, Safari and Firefox.
- **0.2 Fork build in CI.** Build `figcraft-web` from source with the pinned `craft-libs` and
  egui fork revisions, trunk and wasm-opt, and publish the static bundle as a CI artifact. Make
  one visible theme change to prove the rebrand route. AC: reproducible build from a clean
  runner; WebAssembly under 24 MiB raw; the changed theme shows in the embedded editor.
- **0.3 Can Claude draw?** Run `figcraft-cli mcp` headless and give Claude the prompts from
  `evals/golden/interactive.json`, using `batch` for edits and `ui.render` to check its work.
  Compare the results with the current HTML-frame agent on the same prompts. AC: a written
  comparison with renders side by side, token use per prompt, and a recommendation. **This is
  the gate:** if command-driven results are clearly worse and no prompt or tool change fixes
  it, stop and fall back to keeping the HTML-frame editor (§9 D19).
- **0.4 Real-browser checks.** (a) `figcraft.screenshot()` timed out in headless Chromium with a
  document open: reproduce in real browsers and find a reliable way to get pixels (`ui.render`
  of frames worked). (b) Detect what a person changed without events: poll `document.inspect`
  with `fields` and diff. (c) Load a large example file and record load time, memory and frame
  times. AC: findings with numbers; a recommendation for change detection until Story 2.3 lands.

### Epic 1 — Foundation (serial; keep it small)
**Done (2026-11-24), in review as PRs #1–#4** (merge in that order). Notes against the stories
below:
- **1.1:** besides this spec, `grep -ri crunch` also finds the one-release env fallback
  (`apps/web/src/server/env.ts`), the README upgrade note and `turbo.json`. The GitHub repo and
  Vercel project are renamed `greenfield`.
- **1.2:** `apps/figma-plugin` was retired here, not in 7.4, because it was built on
  `figma-convert`. Until Epic 4, running an agent turn or job returns 503
  (`AgentUnavailableError`), and share links show a "can't be viewed yet" page.
- **1.3:** CI runs the real-editor suite in Chromium and WebKit only (Story 8.3).
- **1.4:** the contract also has `suggest_generation_job`, and `ask_questions` is renamed
  `ask_followup`. `run_batch` blocks file, export, plugin, collaboration and undo commands by
  default.

*Demo: the renamed app runs with the editor embedded and no HTML-model code left.*

- **1.1 Rename to Greenfield.** `@crunch/*` → `@greenfield/*`, `CRUNCH_*` → `GREENFIELD_*`,
  database and test database names, the Deploy Button URL and repository, the Figma plugin name,
  docs, `CLAUDE.md` and `AGENTS.md`. One PR, merged while no other branches are open (it touches
  about 1,400 files). AC: `pnpm lint && pnpm typecheck && pnpm test` pass; `grep -ri crunch`
  finds only the changelog and migration history; old env names are read as fallbacks for one
  release with a warning.
- **1.2 Remove the HTML model.** Delete `packages/doc-model`, `renderer`, `canvas`, `ds-lint`,
  `figma-convert` and `handoff`, the sliders, the editor components that used them, and their
  tables (one migration). Keep `authz`, `providers`, `crypto`, `db`, `contracts`, `agent` (tools
  rewritten in Epic 4) and `sandbox-runner`. AC: the app builds; the projects list still works;
  opening a project shows the embedded editor from 0.1.
- **1.3 `packages/bridge`.** A typed client over `window.figcraft` and the host messages:
  `execute`, `batch`, `inspect`, `getNode`, `render`, `open`, `onSave`, `onDirty`, `onReady`.
  Command parameter types are generated from `figcraft.commands()` for the pinned editor
  version. Includes an in-memory mock for unit tests and a Playwright helper that drives the
  real editor. AC: every other lane imports only this package to reach the editor; a CI check
  fails when the pinned editor's command list changes without regenerating types.
- **1.4 Agent tool contract** (`packages/contracts`). Tool definitions for the agent:
  `get_selection`, `get_outline`, `get_node`, `run_batch`, `render`, `list_commands`,
  `ask_followup`, plus `comment_thread` for Ask Claude. Zod-validated; identical for the
  interactive path and jobs. AC: schema tests; a fake executor runs the golden prompts' tool
  calls against the mock bridge.

### Epic 2 — Fork (Rust lane)
*Demo: the editor looks like Greenfield, shows no ArtCraft marks, and reports changes and
selection to the host.* Lives in its own repository (`green-sky-technologies/greenfield-editor`).
Keep each patch small and isolated; offer upstream anything generic (2.3, 2.5, 2.8).
Start from `spikes/0.2-fork-build` (`build.sh`, the theme patch and the CI workflow).

- **2.1 Greenfield theme (canvas only).** In canvas mode only what the canvas draws needs
  theming: the canvas background, selection and hover outlines, handles, size badges, frame
  labels, guides, snapping lines, the text caret and comment pins. Use the brand tokens in
  `docs/brand/README.md` (field green for selection, Plex for frame labels). The editor's
  panels keep their own look for the fallback (5.13); their 333 hard-coded corner radii are out
  of scope. AC: matches the brand sheet; the host switches dark and light with `view.themeDark` /
  `view.themeLight`.
- **2.2 Remove ArtCraft marks.** Replace the FigCraft name, wordmark, logo, app icon and loading
  screen with Greenfield's; keep the MIT/Apache licence texts, `NOTICE` and `ATTRIBUTION.md`. AC: a CI check fails on the
  FigCraft or ArtCraft name or logo in user-visible strings and assets (code identifiers may
  stay).
- **2.3 Host events (required for canvas mode).** Post `document changed` (with changed node ids and whether a person or the
  control channel made the change) and `selection changed` to the host in host mode. AC: the
  host learns about every edit within one frame; agent edits are labelled as such; no events
  when the page is not hosted. Also post `tool changed`, `text editing started/ended` and
  `viewport changed` (zoom and scroll), which our toolbar, floating toolbar and overlays need.
- **2.4 Claude's presence.** FigCraft already shows an agent like a person in a live session:
  commands run through the control channel with `agent: "<name>"` (`engine.execute`, then
  `Session::execute_as`) set `AgentPresence`, and the canvas outlines the layers it last edited
  or selected in its colour with its name (`ui-egui/src/live/agent.rs`). Our patch:
  - its colour is ember (`#ff9a4d` dark, `#a54a0f` light), not FigCraft's amber;
  - the host holds the presence for the whole agent turn (`agent.presence {name, active}`), not
    the 8-second `LINGER`;
  - presence is posted to the host (so our people row shows Claude's avatar), and `batch` carries
    the `agent` name like `engine.execute` (check that it does today);
  - optional: a cursor that glides to the layer being edited, reusing the live-session cursor.

  AC: during a turn the outline and tag stay on every layer Claude touched; they never appear in
  exports or `ui.render`; the user's own selection still draws in green on top.
- **2.5 Superseded by canvas mode.** Our own comment composer (6.2) replaces the editor's.
- **2.6 Superseded by 2.11.** Canvas mode hides the home screen, tabs and menus too.
- **2.7 Upstream sync.** A documented rebase routine and a monthly cadence; the bridge's
  generated command types are regenerated on every sync. AC: one sync done end to end.
- **2.8 Save acknowledgement.** Saves carry an `id`, and the editor clears dirty only when the host
  answers `figcraft:saved {id}`. Today dirty clears as soon as the bytes are posted, so a failed
  upload looks saved. AC: a failed upload leaves the document dirty.
- **2.9 Build inputs and size budget.** Build with `storytold/craft-fonts` (OFL; ship the OFL texts)
  and upstream's `storytold/winit` fork, both pinned. Our own CI check fails a `.wasm` over
  25 MiB raw. To make room, limit the embedded fonts (`FIGCRAFT_WEB_FONTS`) or load fonts outside
  the wasm. Pin binaryen and wasm-bindgen versions; different wasm-opt versions give different
  bytes. AC: byte-identical output from two clean builds; the size check runs on every build.
- **2.10 Small patches the spikes asked for.** All are upstreamable:
  - `revision` and undo depth in `document.inspect`, to give change detection a cheap, exact gate;
  - a repaint request while a screenshot is pending, so `ui.screenshot` settles in the browser;
  - a warning in the command result when a font isn't available, because today the text silently
    renders in a fallback face while `inspect` reports the requested style.

  AC: each has a test upstream or in the fork.
- **2.11 Canvas mode.** A host flag (`?canvas` and a `view.canvasMode` command) that draws only
  the canvas: no rail, panels, tab bar, toolbar, home screen, menus or context menus.
  `view.toggleUi` today hides the panels but leaves the tab bar, and Hide UI keeps the toolbar.
  Built on the existing `ui_hidden` path in `ui-egui/src/app.rs`. Right-click and the editor's
  popovers (colour picker, font menu) post a request to the host instead of opening, with the
  position and target, so the shell draws its own (5.10, 5.11). Keyboard shortcuts keep working
  in the canvas. AC: in canvas mode the iframe shows nothing but the canvas and its overlays; the
  fallback (5.13) can turn the editor's panels back on without reloading.
- **2.12 Gesture commands.** Expose the engine's gestures, which the editor's own panels use for
  scrubbing (`begin_interaction`, `preview`, `commit_interaction` and `cancel_interaction` in
  `engine/src/session/undo.rs`), as commands: `edit.begin {label}`, `edit.preview {commands}`,
  `edit.commit`, `edit.cancel`. AC: dragging a value in our inspector updates the canvas every
  frame and makes one undo step; Esc during a drag restores the value.

### Epic 3 — Files, versions and sharing (TS lane)
*Demo: edits autosave; a named version restores; a public link opens the design read-only.*

- **3.1 Files in Blob.** Each project holds one or more `.figcraft` files; open sends
  `figcraft:open`, save writes Blob and the `files` row. Start from `services/design-files`
  (Story 1.2: one file per project, private Blob with a local-folder fallback).
  - Saves upload straight from the browser to **private** Blob through an authenticated
    `handleUpload` route. Vercel caps function bodies at 4.5 MB, so today's `PUT` route can't
    carry real files.
  - The edit lock is checked on save; today it isn't.
  - Run the Blob path end to end on a preview deployment. It has never run; tests used the local
    fallback.

  AC: open → edit → reload restores the exact document; a save from a stale lock is refused, not
  merged; a 20 MB file saves.
- **3.2 Autosave.** Save a short time after the editor reports dirty, and on tab close where
  the browser allows. Track unsaved state in the host until 2.8 lands, since the editor's dirty
  flag clears before the upload is stored. AC: no edit older than the autosave interval is lost on a crash
  (FigCraft's own recovery copy covers the rest).
- **3.3 Versions.** Automatic versions on a timer, an `agent` version before every agent turn
  (old D14), and named versions. Restore makes a new version. AC: one-click "Undo the AI" from any
  agent turn; restoring never destroys history.
- **3.4 Soft edit lock.** Carry over the lock and "request control" (old D3) to files. AC: a
  second Editor opens read-only with the holder's name and a request button.
- **3.5 Share links and read-only viewing.** Viewers and public links open the editor
  read-only. AC: a Viewer cannot change the document through the UI or the bridge (enforced
  server-side on save as well); public links need no sign-in and are rate-limited.
- **3.6 Thumbnails.** Render the first frame for the projects list from the saved file with
  headless `figcraft-cli`, at a scale computed from its bounds, not from the user's tab.
- **3.7 New files open on a document.** A new project opens a blank document, not FigCraft's home
  screen; the host sends `file.new` until canvas mode (2.11) hides the home screen.
- **3.8 Comment access.** Share links and file access gain a "can comment" level between view
  and edit, as in Claude Design: comment and reply, no edits, no agent turns.

### Epic 4 — Agent (TS lane)
*Demo: "tighten the hero" changes three layers as one undo step, with the changes listed in
chat; "design a pricing page" runs as a job and appears as a new page.*

Start from the 0.3 winner (`spikes/0.3-agent`, variant `v2`) and the 1.4 contract:
- **Tools:** `run_batch` (one undo step per edit), `get_node`, `render` on request, and
  `suggest_generation_job`.
- **Context:** the scope subtree plus the page outline.
- **Prompt:** the curated command reference and the `v2` craft rules (set `fontFamily` with
  `fontStyle`; copy sibling styles; equal-height card rows). Don't put the full command catalogue
  in the prompt: it cost about 4× with no gain.

The agent is switched off until this epic wires it up (Story 1.2).

- **4.1 Context.** For each turn: the selection's subtree (`node.get` with `fields`), a compact
  outline of the page, the file's variables and styles. AC: context for a one-element request
  stays within a set token budget (eval-checked).
- **4.2 Interactive path with browser-run tools.** The server runs the Messages API loop; tool
  calls stream to the client over SSE, run through the bridge, and the client posts results
  back. Mutations go through one `run_batch` per step (one undo step each). A hidden tab pauses
  the turn: the bridge fails fast with `EditorHiddenError`, and the turn resumes when the tab is
  shown. Every scoped request is enforced: an edit outside the scope is undone and returned as an
  error. AC: a closed tab cancels the turn cleanly; a tool call is never run twice (idempotency
  key); a one-element change touches only that element (eval).
- **4.3 Self-check.** After mutating, the agent renders the affected frame (`ui.render` with `ids`
  and `scale` in the browser; the `screenshot` tool in `figcraft-cli` jobs) and checks it against
  the request. The design system's fonts must be available to the editor, so that a `fontStyle`
  can't silently fall back. AC: capped at N retries; renders are not stored beyond the turn
  unless the user keeps them.
- **4.4 Follow-up questions.** Carry over the question cards (multiple choice, free text, "You
  decide") to the new tool contract.
- **4.5 Jobs with headless `figcraft-cli`.** "Generate", "redesign" and "N alternatives" run in
  Vercel Sandbox on a copy of the file; the result is saved as an `agent` version and opened as a
  new page or tab for review. AC: progress streams to the chat; the user can close the tab and
  come back; cancel stops the sandbox.
- **4.6 Sandbox safety.** Keep the LLM proxy rule: no real keys in the sandbox; `figcraft-cli`
  runs with `--automation-read-root` / `--automation-write-root` confined to the job's folder.
  AC: tests prove both.
- **4.7 Change summary.** Every agent turn lists changed layers and properties (from 2.3 events,
  or by diffing `document.inspect` before and after until 2.3 lands), with "Show on canvas" and
  "Undo all". AC: the list matches the actual changes.
- **4.8 Eval suite.** Port `evals/golden` to command-driven tools: scope of change, render
  checks, token use. The 1.4 replay already checks scope against the mock.
  - Add build-a-screen cases (the 0.3 pricing and testimonials prompts, and more), judged
    side by side and blind.
  - Re-baseline the job hand-off cases now that `ask_followup` exists.
  - Replace `lintClean` with a check against the file's variables and styles.

  AC: runs in CI on demand and tracks regressions per model.
- **4.9 Model picker / 4.10 Usage.** Carried over; task types updated (interactive, job,
  export).

### Epic 5 — Greenfield chrome in canvas mode (React lane)
*Demo: the Editor mockup, working: our toolbar, layers and inspector edit a design on the
FigCraft canvas, and Claude edits beside you.* Panels read one store, `packages/editor-state`,
fed by the bridge's events (2.3; polling `document.inspect` until it lands) and write only
through bridge commands and gestures (2.12). After 5.0 and 5.6, stories 5.7 to 5.11 are separate
lanes.

- **5.0 Canvas-mode spike (gate).** Prove the risky parts before building panels:
  - the editor hidden down to the canvas (with today's `view.toggleUi`, or a first cut of 2.11);
  - a React layers list that stays in sync while you edit on the canvas;
  - a React inspector for position, size and fill of the selection, with a scrubbable number
    field that makes one undo step (a first cut of 2.12);
  - Claude's presence from a command sent with `agent: "Claude"`.

  Measure the time from canvas click to inspector update and from scrub to canvas repaint. AC: a
  written go/no-go with numbers in `docs/adr/0005-canvas-mode.md`; each feels as fast as the
  editor's own panels (target: under one frame of added latency at 60 fps).
- **5.1 Top bar.** File name and project, the tool row (`tool.*` commands, active tool from 2.3
  events), "Comment or ask", the people row with Claude's avatar, zoom, Present, Share, Export.
- **5.2 Agent pane.** Chat with streaming, the selection chip, the change list (4.7), follow-up
  cards, cancel and retry, job cards.
- **5.3 Themes.** Light and dark app chrome from the brand sheet, kept in step with the
  editor's theme through the bridge. AC: switching one switches both.
- **5.4 Focus and shortcuts.** Keyboard focus moves cleanly between the React panes and the
  editor iframe; C opens "Comment or ask"; Esc returns to the canvas; F6 and Shift+F6 cycle the
  top bar, left panel, canvas and right panel; Cmd+\ toggles the edit panel. The editor maps
  shortcuts per platform (Cmd on a Mac, Ctrl elsewhere), so neither the shell nor tests may
  hard-code Ctrl. AC: no shortcut fires in both places; screen-reader labels on every control.
- **5.5 Claude as a collaborator.** Claude's avatar in the people row, ringed in ember while a
  turn runs; its outline on the canvas (2.4); "changed by Claude · Revert" on inspector values it
  set; the change list's "Show on canvas" selects and zooms to the layers.
- **5.6 Editor state store.** `packages/editor-state`: selection, the selected nodes' properties,
  the page tree, active tool, viewport and dirty state, as React hooks (`useSelection`,
  `useNode(id)`, `usePageTree`, `useTool`). AC: one subscription per panel; a 30k-node file keeps
  the layers panel responsive (virtualised).
- **5.7 Layers and pages.** Page list; layer tree with expand and collapse, rename, reorder by
  drag, lock, hide, multi-select; component and instance rows marked.
- **5.8 Inspector: core.** For the selection: position, size and constraints; auto layout
  (direction, gap, padding, alignment, wrap, Hug / Fixed / Fill); radius; fill, stroke and effects
  lists; text (family, weight, size, line height, letter spacing, alignment); opacity and blend;
  mixed values for multi-select. Number fields scrub with 2.12.
- **5.9 Inspector: components, variables and styles.** Instance properties and variants; apply
  and detach styles; bind a value to a variable; variable modes on frames.
- **5.10 Context menu and floating toolbar.** Our right-click menu from the editor's request
  (2.11); the floating toolbar over the selection when the edit panel is hidden.
- **5.11 Pickers.** Colour picker (with variables and styles), font picker (with the design
  system's fonts first), and the export panel.
- **5.12 Prototype and Code tabs.** The Prototype tab edits links and transitions (`proto.*`);
  the Code tab shows FigCraft's generated code for the selection (7.2).
- **5.13 Fallback to the editor's panels.** A menu item turns the editor's own panels back on
  for anything our chrome doesn't cover yet. Remove it when 5.7–5.12 cover the commands people
  use. AC: switching back and forth keeps the selection and undo history.

### Epic 6 — Comments and Ask Claude (TS lane)
*Demo: a teammate comments on a heading; the owner turns a comment into an agent request.*

- **6.1 Comments in the file.** Use the editor's comment threads (`comment.add` with a node
  anchor and author, replies, resolve). Mirror them into `comment_index` on save for
  notifications and @mentions. AC: comments follow their element when it moves.
- **6.2 Ask Claude.** From our own composer, which the shell positions at the element (the
  editor's comment tool posts the click to the host in canvas mode). Sends the text and element to the agent
  pane; `comment.prompt` turns existing threads into context. AC: one action from writing a note
  to an agent turn scoped to that element.
- **6.3 Notifications.** In-app notifications for mentions and replies; email later.
- **6.4 Comments list.** A Comments view in the left panel: open and resolved threads, jump to
  the element, reply, and "Ask Claude" from any thread.

### Epic 7 — Export (TS lane)
*Demo: export PNG, SVG and PDF; copy React code for a selected frame.*

- **7.1 Built-in exports.** PNG, JPG, WebP, SVG and PDF through the editor's export commands,
  available to Viewers (no model use).
- **7.2 Evaluate Dev Mode code.** Compare FigCraft's generated code (CSS, React, and others) and
  Code Connect with the old React + Tailwind export. AC: a written decision.
- **7.3 React + Tailwind job** (only if 7.2 says so). An Agent SDK job reads node JSON and writes
  a project that builds in the sandbox. Editor role required.
- **7.4 Figma.** `.fig` import comes from the editor (best effort). `apps/figma-plugin` was
  retired in 1.2; bring back a push to Figma only if 7.2 or users show a need.
- **7.5 PPTX and HTML export.** Slide decks (Epic 13) export to PPTX and PDF; any frame or flow
  exports to standalone HTML that works offline (from FigCraft's generated code, 7.2).
- **7.6 Handoff bundle.** One download for a coding agent: the frames as images, the generated
  code, the variables and styles, the component list and the design intent from the chat.
  AC: Claude Code builds the screen from it with one instruction.
- **7.7 Greenfield MCP server.** Claude Code (and other agents) can list a workspace's files and
  read and edit them through the same tool contract as the in-app agent (1.4), with the user's
  permissions. Builds on `figcraft-cli mcp` running in a job.

### Epic 8 — Operations and security (any lane)
- **8.1 Serving the editor.** Same-origin `/editor/` static route, content security policy
  that allows the editor's WebAssembly and nothing else extra, and a version pin shared with the
  bridge.
  - **The bundle is trusted code:** it runs with the app origin's privileges. It's pinned by
    sha256 or built by us, never loaded from a CDN or upstream at runtime, and reviewed on every
    sync.
  - Today `apps/web/scripts/fetch-editor.mjs` pins the upstream release; switch it to the fork's
    CI artifact once 2.9 publishes one.
- **8.2 Caching and budgets.** Brotli, immutable hashed assets (the `/editor/` cache headers from
  Story 0.1 are in place), and the 25 MiB wasm budget from 2.9. Add a performance budget for
  effects at device pixel ratio 2, with the effects-heavy dashboard example as the test file.
- **8.3 Tests through the iframe.** Extend the Playwright suites to drive the real editor via
  the bridge helper (1.3). Get Firefox running on CI: headless Firefox on GPU-less Linux runners
  has no WebGL2, so the editor can't start (try a headed run under xvfb). AC: open, edit, save,
  reopen, and an agent turn with a stubbed model, in all three engines on CI.
- **8.4 Licences.** Ship FigCraft's licence texts, `NOTICE` and attribution; legal review of
  MIT/Apache code in an AGPL-3.0 product.
- **8.5 Carried over.** Environments, observability, authorization tests per route, data
  lifecycle (old 9.1–9.4); remove the CSP rules for rendered HTML frames.
- **8.6 Rename clean-up.**
  - Rename the `CRUNCH_*` variables in Vercel.
  - Remove the fallback in `apps/web/src/server/env.ts` in the release after 1.1.
  - Make the Deploy Button provision a **private** Blob store; it creates a public one today.

### Epic 9 — Brand and launch (design lane; starts now)
- **9.1 Brand assets.** Greenfield mark (dark and light, 16 to 256 px), favicon, wordmark
  lockup, into the app and the fork.
- **9.2 Marketing page.** A Greenfield page in the Green Sky family.
- **9.3 Docs.** README, self-hosting guide, and "how the agent works".

### Epic 10 — Design systems (TS lane)
*Demo: point Greenfield at a repository; review the colours, type and components it proposes;
publish it; every new file starts from it and Claude's output matches it.* A design system is a
`.figcraft` library file (variables, styles, components) plus a short guide for Claude.

- **10.1 Model.** `design_systems` and `design_system_versions` tables pointing at a library file
  and a guide (markdown). A workspace can have several; one is the default.
- **10.2 Build from sources.** A job reads a GitHub repository or uploaded code (tokens, Tailwind
  config, CSS variables, React components), a `.fig` file, or images, decks and PDFs, and writes
  the library file and guide. AC: from a typical Tailwind repo it produces the colour, type and
  spacing variables and the core components (button, input, card, nav).
- **10.3 Review.** A review page: each colour group, type style and component with keep or drop;
  dropped ones are removed before publishing.
- **10.4 Publish and default.** Published systems are available to the workspace; the default is
  attached to every new file. Admins can limit who publishes and sets the default.
- **10.5 Claude follows it.** The system's guide and a summary of its variables, styles and
  components go in the agent's cached prefix; the agent uses variables and components instead of
  raw values; a deterministic check flags raw colours and off-scale spacing after each turn and
  the agent fixes them (replaces old `ds-lint`; see 4.8).
- **10.6 Updates.** A new version of the system updates files that use it (library update, with
  a review of what changes).

### Epic 11 — Tweaks (TS lane)
*Demo: "give me a density control" adds a slider; dragging it changes padding and gaps across the
page live, at zero tokens.*

- **11.1 Model.** Tweaks are stored in the file (a plugin-data or variable collection the editor
  keeps): label, kind (slider, toggle, choice, colour), range, and bindings to variables or node
  properties with a mapping.
- **11.2 Agent tool.** `create_tweak` in the tool contract; Claude proposes tweaks with a design
  or on request.
- **11.3 Tweaks panel.** A Tweaks section in the edit panel; dragging applies through gestures
  (2.12): live, one undo step, no model call.
- **11.4 Variables first.** Where a tweak drives several layers, bind it to a variable and set the
  variable, so the design stays editable by hand.

### Epic 12 — Bring your context (TS lane)
- **12.1 Images and screenshots in chat.** Paste or drop; sent to the model as images; placeable
  on the canvas.
- **12.2 Documents.** PDF, DOCX, PPTX and XLSX attached to a chat turn as text (and page images
  for PDFs and decks).
- **12.3 `.fig` import.** Open a Figma file through the editor's importer as a new file, with an
  import report (best effort).
- **12.4 Web capture.** Capture a live page's structure and styles into a frame (a bookmarklet or
  the sandbox's browser), as a reference to build from. AC: SSRF-safe (8.5).
- **12.5 Linked repository.** Link a GitHub repository to a project; the agent can read its
  components and styles when asked (and Epic 10 builds from it).

### Epic 13 — Prototype and present (TS lane)
- **13.1 Play.** Play a prototype from any frame in the browser (FigCraft's present mode), from
  the top bar's Present button and from share links.
- **13.2 Slide decks.** A "Deck" project type: 16:9 frames as slides, a slide list in the left
  panel, speaker notes, present full screen with keyboard navigation; Claude builds decks from a
  brief or a document. Exports with 7.5.
- **13.3 Project types and fidelity.** New project: Design or Deck; wireframe or high fidelity;
  with or without the design system.

---

## 7. Build Order

1. **Phase 0 — done (2026-11-24):** stories 0.1–0.4 passed the gate; go (ADR 0003).
2. **Phase 1 — in review:** 1.1 → 1.2 → 1.3 and 1.4 together, as PRs #1–#4. Merge them in
   order before Phase 2 branches start, so the lanes start from one tree.
3. **Phase 2 — next:** Epics 2–8 in parallel, one owner each. Integration points: 2.3 → 4.7 and
   5.5; 2.4 → 5.5; 2.5 → 6.2; 2.8 → 3.2. Suggested first stories:

   | Lane | Start with | Why first |
   |---|---|---|
   | 2 Fork | 2.9, then 2.8 and 2.10 | Size budget and reproducible build; save acknowledgement is a data-loss fix |
   | 3 Files | 3.1, then 3.7 | Saves over 4.5 MB fail today, and the lock isn't enforced |
   | 4 Agent | 4.2 with 4.1 | Turns the agent back on with the 0.3 `v2` prompt |
   | 5 Shell | 5.1, 5.4 | Everything else hangs off the top bar and focus handling |
   | 6 Comments | 6.1 | |
   | 7 Export | 7.1, then 7.2 | |
   | 8 Ops | 8.6, 8.1, 8.3 | Env rename deadline; trust boundary; Firefox on CI |
4. **Phase 3 — canvas mode and the ten features (from 2026-11-24):**
   - **First, in parallel:** the canvas-mode spike (5.0) in the shell lane, and 2.11 and 2.12 in
     the fork lane (5.0 can start on today's `view.toggleUi` and polling).
   - **After 5.0 says go:** 5.6 (store), then 5.7, 5.8, 5.10 and 5.11 as separate lanes; 2.3 and
     2.4 in the fork lane; 5.5 once 2.4 lands.
   - **Independent of canvas mode, start any time:** Epic 10 (design systems), Epic 12 (context),
     6.4, 3.8, 7.5–7.7. Epics 11 and 13 after 2.12 and 5.8.
5. **Beta:** the ten features in §6a working; 8.3 and the authorization tests green; legal
   review (8.4) done.

---

## 8. Deferred (post-v1)
Real-time multiplayer between people (FigCraft live sessions or `figcraft-server`) · group chat
with Claude · plugins in the browser build (not supported upstream yet) · billing · personal keys
· mobile · two-way Figma sync · desktop app · live-code frames (HTML, shaders, video, 3D).
The rest of the Claude Design baseline is listed in appendix A, with stories in `ROADMAP.md`.

---

## 9. Decision Log

New decisions:

| # | Decision | Rationale |
|---|---|---|
| D19 | Embed a FigCraft fork as the editor (option C), subject to the 0.3 gate; fall back to the HTML-frame editor if the agent can't draw well | A real vector editor with an existing command API and host mode; the spike embedded, drove, saved and reopened it. |
| D20 | v1 keeps the editor's own layers and inspector, themed in the fork; the shell owns the top bar, agent pane and comments | Rebuilding the inspector in React covers components, variables and prototyping; too large for v1. |
| D21 | All app code talks to the editor through `packages/bridge`, pinned to one editor version | Lets every TS lane build against the upstream release while the fork catches up. |
| D22 | Interactive agent tools run in the browser; jobs run headless `figcraft-cli` on a file copy | The document lives in the user's iframe; jobs must survive a closed tab. |
| D23 | Comments live in the `.figcraft` file, mirrored to Postgres | Uses the editor's anchoring and pins; Postgres only for notifications and search. |
| D24 | Green for the user, ember for the agent, everywhere | You can always tell your edits from the agent's. |
| D25 | Go on D19 after the 0.3 gate; the agent starts from the 0.3 `v2` prompt and tool shape | Comparable to the HTML agent on the golden prompts and two build-a-screen prompts; half the cost on small edits (ADR 0003). |
| D26 | Wasm budget is 25 MiB raw (was 24), checked by our own build | A release-equivalent build with fonts is 24.39 MiB; upstream's own gate is 25 MiB. |
| D27 | `apps/figma-plugin` retired in Story 1.2, ahead of 7.4 | It was built on `figma-convert`, which 1.2 deletes. |
| D28 | **Canvas mode:** the editor draws only the canvas; all chrome is Greenfield's React (reverses D20) | The embedded editor's own panels can't be made to look and work like Greenfield. FigCraft's command list already covers what a full interface needs, so the editor becomes the engine, as Figma's is. |
| D29 | Claude appears as a collaborator, built on FigCraft's agent presence (`execute_as`) | It already draws an agent like a person in a live session; we restyle it and hold it for the turn. |
| D30 | Tweaks return, bound to variables and properties (reverses the D16 drop) | One of Claude Design's signature features; zero-token tuning fits the cost rules (§2). |
| D31 | Standalone Claude Design is the feature baseline; §6a's ten come first | It closes 2026-12-14; its AI workflow is what Greenfield must match. |

Superseded from CrunchDesign: **D1** (live HTML frames) by D19; **D2** (flow-first drag) and
**D15** (breakpoint overrides) by the editor's auto layout and constraints; **D11** (export v1)
by Epic 7; **D12** (Figma plugin push) by 7.4; **D16** (sliders) dropped, then brought back as
Tweaks by D30. **D20** (keep the editor's panels) is reversed by D28. Still in force: D3,
D4, D5, D6, D7, D8, D9, D10, D13, D14, D17, D18.

## 10. Open Questions
1. Does the 0.3 comparison hold up across more than the golden prompts? Partly answered: it
   held on two build-a-screen prompts, but the judging wasn't blind and used one fixture (4.8).
2. Upstream relationship: contribute host events and the composer action to FigCraft, or keep
   them in the fork?
3. Do we need `.figcraft` diffs for version compare, or are rendered side-by-sides enough?
4. Domain: greenfield.greensky.tech?
5. Canvas mode upstream: offer 2.11 and 2.12 to FigCraft, so fewer fork patches carry them?
6. Tweaks storage: a variable collection, plugin data, or our own table?

---

## Appendix A — Claude Design coverage

Standalone Claude Design's features (from its help centre, launch post and reviews, November
2026) against this plan. **Top 10** = in §6a; **Later** = after beta, with stories in
`ROADMAP.md`; **Research** = a spike in `ROADMAP.md` decides whether and how.

| Area | Claude Design feature | Greenfield |
|---|---|---|
| Start | Project types: prototype, slide deck, template; wireframe or high fidelity; one-pagers | Top 10 (13.3); templates later (14.1) |
| Start | Examples gallery | Later (14.2) |
| Start | Sketch a starting layout | Later (14.3) |
| Inputs | Images and screenshots | Top 10 (12.1) |
| Inputs | DOCX, PPTX, XLSX, PDF | Top 10 (12.2) |
| Inputs | Figma files | Top 10 (12.3) |
| Inputs | Web capture | Top 10 (12.4) |
| Inputs | Codebase / GitHub | Top 10 (12.5, 10.2) |
| Inputs | Voice dictation | Later (Epic 16) |
| Design systems | Built from codebase, design files and uploads | Top 10 (10.2) |
| Design systems | Review, publish, default, admin limits, several per workspace | Top 10 (10.3, 10.4) |
| Design systems | Output checked against the system | Top 10 (10.5) |
| Design systems | `/design-sync` from Claude Code | Later (17.1, 17.2) |
| Chat | Chat beside the canvas; clarifying questions; alternatives; explain or review | Top 10 (Epic 4, 5.2) |
| Chat | Group conversations with Claude | Later (Epic 18) |
| Refine | Inline comments to Claude or teammates; comments view | Top 10 (6.1, 6.2, 6.4) |
| Refine | Direct editing: drag, resize, align, text | Top 10 (canvas) |
| Refine | Edit panel (Simple and Pro), properties toggle (Cmd+\), floating toolbar | Top 10 (5.8–5.10) |
| Refine | Tweaks: knobs and Claude-made sliders | Top 10 (Epic 11) |
| Refine | Drawing on the canvas as instructions | Later (Epic 15) |
| Canvas | Artboards, pages, notes, guides, Play, links between screens | Top 10 (FigCraft, 13.1) |
| Canvas | Live-code prototypes: voice, video, shaders, 3D, AI | Research (Epic 21) |
| Versions | Save and try another approach | Top 10 (3.3, beyond it: real versions) |
| Present | Present decks in the app | Top 10 (13.2) |
| Share | Private by default; view, comment or edit | Top 10 (3.5, 3.8) |
| Export | ZIP, PDF, PPTX, standalone HTML | Top 10 (7.1, 7.5); ZIP later (19.1) |
| Export | Google Slides | Later (19.2) |
| Export | Send to Canva, Adobe, Lovable, v0, Vercel, Netlify and others | Later (Epic 20) |
| Handoff | Handoff bundle to Claude Code | Top 10 (7.6) |
| Handoff | Claude Code integration (`/design`, MCP) | Top 10 (7.7) |
| Access | Keyboard regions (F6), layers by keyboard | Top 10 (5.4, 5.7) |
| Access | Mobile apps | Research, then build (Epic 22) |

