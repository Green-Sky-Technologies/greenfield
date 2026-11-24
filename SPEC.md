# Project: Greenfield — open design tool with an agent

> **Handoff brief for Claude Code.** Greenfield (formerly CrunchDesign) is a web design tool:
> a real vector editor with an agent built in. The editor is a fork of
> [FigCraft](https://github.com/storytold/figcraft) (Rust, compiled to WebAssembly) embedded in
> our Next.js app. The app adds workspaces, the agent, comments that can be sent to the agent,
> storage, versions and sharing.
>
> Written as epics and user stories with acceptance criteria (AC). The plan is built for
> **parallel work**: after a short serial foundation, epics 2 to 9 are lanes that one person or
> one Claude Code session can each take at the same time. Decisions are logged in §9.
>
> **Status (2026-11-24):** Phase 0 passed the gate (go, ADR 0003) and Phase 1 is in review
> (PRs #1–#4). Next is Phase 2: see §7 for what each lane starts with.

---

## 0. Context & Purpose

**Core loop:** draw it yourself (canvas, tools, inspector) **or ask** (agent pane, or a comment
sent to the agent) → review what the agent changed → share or export.

**Two principles for the product:**
1. **Direct control is the default.** The canvas works like a professional design tool, with no
   modes to switch between. The agent is a pane and a comment action, not the whole app.
2. **You can always tell your edits from the agent's.** Green marks you (selection, focus,
   primary actions); ember marks the agent (what it is editing, values it changed, its turn).

**Brand:** "Greenfield — Design in the open." A Green Sky product, in the same family as the
greensky.tech site: square corners, hairlines instead of cards, a 32-unit pixel mark. Brand
sheet and editor mockups: the "Greenfield brand and editor" design canvas.

**Non-goal:** cloning any product's visual identity. FigCraft's own name and logos are
trademarks of the ArtCraft Team and must not appear in Greenfield (see Epic 8).

**Out of scope for v1** (see §8): real-time multiplayer, accounts across Greenfield servers,
billing, mobile, a React rebuild of the inspector (§9 D20), two-way Figma sync.

---

## 1. Target Stack

| Layer | Choice | Notes |
|---|---|---|
| App shell | **Next.js (React + TS)** on **Vercel** | Top bar, agent pane, comments, workspaces, settings. |
| Editor | **FigCraft fork** (`figcraft-web`, Rust → WebAssembly, egui on WebGPU/WebGL2) | Embedded in a same-origin `<iframe>` in host mode (`?host=parent&control`). Owns the canvas, tools, layers and inspector in v1. |
| Bridge | **`packages/bridge`** | Typed client for `window.figcraft` (commands, `document.inspect`, `node.get`, `ui.render`) and the host messages (`figcraft:ready/open/save/dirty`). The only way app code talks to the editor. |
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
 ├── Next.js shell: top bar · agent pane · comment actions · settings
 │      │  bridge (postMessage + window.figcraft, same origin)
 │      ▼
 └── <iframe /editor/?host=parent&control>  Greenfield editor (FigCraft fork, WASM)
            canvas · tools · layers · inspector · comment pins
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
9. Carried over: credential exposure in sandboxes (Story 4.6), prompt-cache TTL, Vercel Hobby
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

See the Editor page of the design canvas.

**Layout:** a slim top bar (file, tools, "Comment or ask", people, zoom, Share), the agent pane
on the left, the editor in the middle and right. In v1 the editor's own layers and inspector
panels stay, themed for Greenfield (§9 D20).

**No modes.** Select and edit at any time, like a professional design tool. Viewers and
archived projects open the editor read-only.

**Asking the agent:**
- **Agent pane:** a message is sent with the current selection attached (shown as a chip). The
  reply lists what changed, layer by layer, with "Show on canvas" and "Undo all".
- **Comment or ask (C):** click an element and write. **Comment** leaves a thread for people;
  **Ask Claude** sends the text to the agent pane with that element attached.
- **Follow-up questions:** before a new design, or for ambiguous or large requests, the agent
  asks in a card (multiple choice, free text, or "You decide"). Small tweaks run without asking.

**Attribution:** while the agent works, the layers it touches are outlined in ember with a
"Claude · editing" tag. Inspector values the agent changed show an ember marker and "changed by
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
  `design_systems`, `design_system_versions`, and the slider tables. Design systems become
  FigCraft variables, styles and component libraries.
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
                                                                 5 Editor shell
                                                                 6 Comments & Ask Claude
                                                                 7 Export
                                                                 8 Ops & security
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

### Carried over from CrunchDesign (built, kept)

Workspaces and Clerk roles (old 1.3), provider credentials and encryption (old 1.4), the spend
cap hook (old 1.5), projects (old 1.6, minus design-system linking), the job runner (old 5.1),
the LLM proxy (old 5.2), the model picker (old 5.9), usage metering (old 5.10), the cache TTL
strategy (old 5.11, ADR 0002), the one-click Vercel setup (old 1.2), and the signed-in e2e suite.
These are not re-specified; stories below say where they change.

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

- **2.1 Greenfield theme.** Dark and light palettes from the brand sheet, IBM Plex Sans and
  Mono in the chrome, square corners, hairline separators, field green for selection and focus.
  AC: matches the brand sheet's tokens; text contrast at least 4.5:1 in both themes; the host
  sets the theme with `view.themeDark` / `view.themeLight` and it persists.
- **2.2 Remove ArtCraft marks.** Replace the FigCraft name, wordmark, logo, app icon and loading
  screen with Greenfield's; keep the MIT/Apache licence texts, `NOTICE` and `ATTRIBUTION.md`. AC: a CI check fails on the
  FigCraft or ArtCraft name or logo in user-visible strings and assets (code identifiers may
  stay).
- **2.3 Host events.** Post `document changed` (with changed node ids and whether a person or the
  control channel made the change) and `selection changed` to the host in host mode. AC: the
  host learns about every edit within one frame; agent edits are labelled as such; no events
  when the page is not hosted.
- **2.4 Agent highlight.** A command to outline node ids in ember with a label ("Claude ·
  editing"), cleared on demand. AC: drawn above the selection, never exported or rendered in
  `ui.render`; survives zoom and pan.
- **2.5 "Ask Claude" in the comment composer.** A second action next to Post that sends
  `{text, anchor nodeId}` to the host instead of creating a thread. AC: only shown in host mode
  when the host enables it; keyboard reachable.
- **2.6 Embed chrome flags.** Host-controlled visibility of the home screen, file tabs and
  menus that Greenfield replaces (the app's top bar owns file and sharing actions). AC: a
  hosted editor opens straight to the document with no FigCraft home screen.
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
  screen; the host sends `file.new` until 2.6 hides the home screen.

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

### Epic 5 — Editor shell (React lane)
*Demo: the Editor mockup, working.* Built against the upstream release from day one.

- **5.1 Top bar.** File name and project, "Comment or ask", people, zoom, Share; the editor's
  own home screen and tabs hidden (2.6) or covered until then.
- **5.2 Agent pane.** Chat with streaming, the selection chip, the change list (4.7), follow-up
  cards, cancel and retry, job cards.
- **5.3 Themes.** Light and dark app chrome from the brand sheet, kept in step with the
  editor's theme through the bridge. AC: switching one switches both.
- **5.4 Focus and shortcuts.** Keyboard focus moves cleanly between the React panes and the
  editor iframe; C opens "Comment or ask"; Esc returns to the canvas. The editor maps shortcuts
  per platform (Cmd on a Mac, Ctrl elsewhere), so neither the shell nor tests may hard-code Ctrl.
  AC: no shortcut fires in both places; screen-reader labels on every control.
- **5.5 Attribution.** Ember outlines while the agent works (needs 2.4) and the "changed by
  Claude · Revert" marker in the change list.

### Epic 6 — Comments and Ask Claude (TS lane)
*Demo: a teammate comments on a heading; the owner turns a comment into an agent request.*

- **6.1 Comments in the file.** Use the editor's comment threads (`comment.add` with a node
  anchor and author, replies, resolve). Mirror them into `comment_index` on save for
  notifications and @mentions. AC: comments follow their element when it moves.
- **6.2 Ask Claude.** From the editor composer's action (2.5), or, until it lands, from an
  overlay composer the shell positions at the element. Sends the text and element to the agent
  pane; `comment.prompt` turns existing threads into context. AC: one action from writing a note
  to an agent turn scoped to that element.
- **6.3 Notifications.** In-app notifications for mentions and replies; email later.

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
4. **Beta:** 8.3 and the authorization tests green; legal review (8.4) done.

---

## 8. Deferred (post-v1)
Real-time multiplayer (FigCraft live sessions or `figcraft-server`) · a React inspector
replacing the editor's own panels · plugins in the browser build (not supported upstream yet) ·
billing · personal keys · mobile · two-way Figma sync · desktop app.

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

Superseded from CrunchDesign: **D1** (live HTML frames) by D19; **D2** (flow-first drag) and
**D15** (breakpoint overrides) by the editor's auto layout and constraints; **D11** (export v1)
by Epic 7; **D12** (Figma plugin push) by 7.4; **D16** (sliders) dropped. Still in force: D3,
D4, D5, D6, D7, D8, D9, D10, D13, D14, D17, D18.

## 10. Open Questions
1. Does the 0.3 comparison hold up across more than the golden prompts? Partly answered: it
   held on two build-a-screen prompts, but the judging wasn't blind and used one fixture (4.8).
2. Upstream relationship: contribute host events and the composer action to FigCraft, or keep
   them in the fork?
3. Do we need `.figcraft` diffs for version compare, or are rendered side-by-sides enough?
4. Domain: greenfield.greensky.tech?
