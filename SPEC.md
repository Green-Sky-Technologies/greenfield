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
   HTML. Unproven. → Story 0.3, the go/no-go gate.
2. **Fork maintenance.** FigCraft moves fast (alpha). Keep our patches small and upstream what
   we can. → Epic 2.
3. **Agent edits during the user's session.** Tool calls run in the user's browser, so a closed
   tab ends an interactive turn. Long work goes to jobs. → Stories 4.2, 4.5.
4. **No change events in the browser build.** Today the host only gets a dirty flag. → Stories
   0.4, 2.3.
5. **Bundle size.** The WebAssembly file is about 18 MiB raw (4.5 MiB Brotli); upstream fails a
   build over 24 MiB. → Stories 0.2, 8.2.
6. **Licences.** FigCraft is MIT or Apache-2.0; Greenfield is AGPL-3.0. Confirm the combination
   with someone qualified. → Story 8.4.
7. Carried over: credential exposure in sandboxes (Story 4.6), prompt-cache TTL, Vercel Hobby
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
- **Agent tools** are command batches: `{ commands: [{ command, params }], label }`, run with the
  editor's `batch` (one undo step, `$step` references to earlier results).

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
Keep each patch small and isolated; offer upstream anything generic (2.3, 2.5).

- **2.1 Greenfield theme.** Dark and light palettes from the brand sheet, IBM Plex Sans and
  Mono in the chrome, square corners, hairline separators, field green for selection and focus.
  AC: matches the brand sheet's tokens; text contrast at least 4.5:1 in both themes; the host
  sets the theme with `view.themeDark` / `view.themeLight` and it persists.
- **2.2 Remove ArtCraft marks.** Replace the FigCraft name, logo and app icon with Greenfield's;
  keep the MIT/Apache licence texts, `NOTICE` and `ATTRIBUTION.md`. AC: a CI check fails on the
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

### Epic 3 — Files, versions and sharing (TS lane)
*Demo: edits autosave; a named version restores; a public link opens the design read-only.*

- **3.1 Files in Blob.** Each project holds one or more `.figcraft` files; open sends
  `figcraft:open`, save writes Blob and the `files` row. AC: open → edit → reload restores the
  exact document; a save from a stale lock is refused, not merged.
- **3.2 Autosave.** Save a short time after the editor reports dirty, and on tab close where
  the browser allows. AC: no edit older than the autosave interval is lost on a crash
  (FigCraft's own recovery copy covers the rest).
- **3.3 Versions.** Automatic versions on a timer, an `agent` version before every agent turn
  (old D14), and named versions. Restore makes a new version. AC: one-click "Undo the AI" from any
  agent turn; restoring never destroys history.
- **3.4 Soft edit lock.** Carry over the lock and "request control" (old D3) to files. AC: a
  second Editor opens read-only with the holder's name and a request button.
- **3.5 Share links and read-only viewing.** Viewers and public links open the editor
  read-only. AC: a Viewer cannot change the document through the UI or the bridge (enforced
  server-side on save as well); public links need no sign-in and are rate-limited.
- **3.6 Thumbnails.** Render the first frame with `ui.render` on save for the projects list.

### Epic 4 — Agent (TS lane)
*Demo: "tighten the hero" changes three layers as one undo step, with the changes listed in
chat; "design a pricing page" runs as a job and appears as a new page.*

- **4.1 Context.** For each turn: the selection's subtree (`node.get` with `fields`), a compact
  outline of the page, the file's variables and styles. AC: context for a one-element request
  stays within a set token budget (eval-checked).
- **4.2 Interactive path with browser-run tools.** The server runs the Messages API loop; tool
  calls stream to the client over SSE, run through the bridge, and the client posts results
  back. Mutations go through one `run_batch` per step (one undo step each). AC: a closed tab
  cancels the turn cleanly; a tool call is never run twice (idempotency key); a one-element
  change touches only that element (eval).
- **4.3 Self-check.** After mutating, the agent renders the affected frame (`ui.render`) and
  checks it against the request. AC: capped at N retries; renders are not stored beyond the turn
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
  checks, token use. AC: runs in CI on demand and tracks regressions per model.
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
  editor iframe; C opens "Comment or ask"; Esc returns to the canvas. AC: no shortcut fires in
  both places; screen-reader labels on every control.
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
- **7.4 Figma.** `.fig` import comes from the editor (best effort). Retire `apps/figma-plugin`
  unless 7.2 or users show a need for pushing to Figma.

### Epic 8 — Operations and security (any lane)
- **8.1 Serving the editor.** Same-origin `/editor/` static route, content security policy
  that allows the editor's WebAssembly and nothing else extra, and a version pin shared with the
  bridge.
- **8.2 Caching.** Brotli, immutable hashed assets, a size budget check in CI.
- **8.3 Tests through the iframe.** Extend the Playwright suites to drive the real editor via
  the bridge helper (1.3). AC: open, edit, save, reopen, and an agent turn with a stubbed model.
- **8.4 Licences.** Ship FigCraft's licence texts, `NOTICE` and attribution; legal review of
  MIT/Apache code in an AGPL-3.0 product.
- **8.5 Carried over.** Environments, observability, authorization tests per route, data
  lifecycle (old 9.1–9.4); remove the CSP rules for rendered HTML frames.

### Epic 9 — Brand and launch (design lane; starts now)
- **9.1 Brand assets.** Greenfield mark (dark and light, 16 to 256 px), favicon, wordmark
  lockup, into the app and the fork.
- **9.2 Marketing page.** A Greenfield page in the Green Sky family.
- **9.3 Docs.** README, self-hosting guide, and "how the agent works".

---

## 7. Build Order

1. **Phase 0:** stories 0.1–0.4 in parallel, plus Epic 9. Decide at the gate (0.3).
2. **Phase 1:** 1.1 → 1.2 → 1.3 and 1.4 together. Short and serial so the lanes start from one
   tree.
3. **Phase 2:** Epics 2–8 in parallel, one owner each. Integration points: 2.3 → 4.7 and 5.5;
   2.4 → 5.5; 2.5 → 6.2.
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

Superseded from CrunchDesign: **D1** (live HTML frames) by D19; **D2** (flow-first drag) and
**D15** (breakpoint overrides) by the editor's auto layout and constraints; **D11** (export v1)
by Epic 7; **D12** (Figma plugin push) by 7.4; **D16** (sliders) dropped. Still in force: D3,
D4, D5, D6, D7, D8, D9, D10, D13, D14, D17, D18.

## 10. Open Questions
1. Does the 0.3 comparison hold up across more than the golden prompts?
2. Upstream relationship: contribute host events and the composer action to FigCraft, or keep
   them in the fork?
3. Do we need `.figcraft` diffs for version compare, or are rendered side-by-sides enough?
4. Domain: greenfield.greensky.tech?
