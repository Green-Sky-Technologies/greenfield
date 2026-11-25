# Greenfield roadmap: after the first ten

`SPEC.md` holds the plan through beta: the ten features in its §6a and their stories (Epics
0–13). This file holds everything else Greenfield needs to match standalone Claude Design, as
epics and stories in the same format, so they are ready to pick up. Numbering continues from
`SPEC.md`.

**Baseline:** standalone Claude Design (claude.ai/design, closing 2026-12-14). `SPEC.md`
Appendix A maps each of its features to a story here or in the spec.

**When:** after the beta bar in `SPEC.md` §7 (the ten features working). Epics here are
independent of each other except where a story says so, so they can run as parallel lanes like
Phase 2. Two epics are research first (21 and 22), because Claude Design's approach doesn't carry
over to a vector editor directly.

| Epic | Feature                                                     | Depends on             | Kind                 |
| ---- | ----------------------------------------------------------- | ---------------------- | -------------------- |
| 14   | Starting points: templates, examples, sketch to start       | 13.3, Epic 10          | Build                |
| 15   | Drawing on the canvas as instructions to Claude             | 5.0 (canvas mode), 4.2 | Build                |
| 16   | Voice                                                       | 5.2, 6.2               | Build                |
| 17   | Claude Code and repositories: design sync, Greenfield skill | 7.7, 10.2, 12.5        | Build                |
| 18   | Multiplayer and group chat with Claude                      | 3.4, 4.2, 2.4          | Build, after a spike |
| 19   | More exports: ZIP, Google Slides                            | 7.1, 7.5, 13.2         | Build                |
| 20   | Send to other tools                                         | 7.5, 7.6               | Build                |
| 21   | Live content in frames: HTML, video, shaders, 3D            | 2.11, 13.1             | Research             |
| 22   | Phone: review, comment and ask from mobile                  | 3.5, 4.5, 6.1          | Research, then build |

Suggested order: 15 and 17 first (they make Claude better at the core loop), then 14, 18 and 19,
then 20, 16, 22 and 21.

---

### Epic 14 — Starting points

_Demo: start a new project from the workspace's own template or from an example, or from a
rough sketch, and Claude builds from it._

- **14.1 Templates.** Save any file as a template (with its design system and tweaks); a
  workspace template gallery on the New project screen; Admins can curate and remove. AC: a new
  project from a template is a copy, never linked; templates respect the workspace's default
  design system unless they carry their own.
- **14.2 Examples gallery.** A small set of Greenfield-made example files (an onboarding flow, a
  pricing page, a deck, a prototype with interactions, a tweaks demo) on the New project screen,
  each with the prompt that made it. AC: opening one makes a copy in the user's workspace; the
  prompt can be rerun against the user's design system.
- **14.3 Sketch to start.** A blank sketch surface (pen, boxes, text) on the New project screen;
  Claude reads the sketch as a layout and builds the first frame from it. Builds on 15.1's
  drawing layer. AC: the sketch is kept beside the result for comparison; a rough three-box
  wireframe yields a matching layout at the chosen fidelity.
- **14.4 One-pager and other project types.** Add project types beyond Design and Deck (one-pager
  for print, social post sizes, email) with frame presets and agent guidance per type. AC: each
  type sets frame sizes, export defaults (PDF for one-pagers) and a line in the agent's prompt.

### Epic 15 — Drawing to Claude

_Demo: circle a card and draw an arrow to the right; Claude moves the card there._

- **15.1 Annotation layer.** A Draw tool in our toolbar that marks on a layer above the design:
  freehand pen, arrow, box, highlighter, in ember-adjacent "markup" colours. Marks are kept in
  the file but never exported or shown in Play. AC: marks scale and pan with the canvas; one
  click clears them; Viewers with comment access can draw.
- **15.2 Send a drawing to Claude.** "Ask Claude" with marks present sends them with the turn:
  a render of the area with the marks over it, plus the marks as vectors with the layers they
  touch. AC: an arrow from a layer to a place is read as a move; a circle around a layer scopes
  the request to it; the agent says what it understood before large changes.
- **15.3 Marks follow up.** After Claude applies a drawn request, its marks are dimmed and
  listed with the turn; Undo restores both the design and the marks. AC: marks never pile up
  unseen across turns.

### Epic 16 — Voice

- **16.1 Dictation.** A microphone button in the agent composer and the comment composer, using
  the browser's speech recognition where available. AC: text appears as you speak and can be
  edited before sending; nothing is recorded or stored when the browser does the recognition.
- **16.2 Transcription fallback.** Where the browser has no speech recognition, record and
  transcribe server-side through a transcription service chosen in an ADR (Claude does not
  transcribe audio). AC: audio is deleted after transcription; metered like model calls; off
  unless an Admin enables it.
- **16.3 Talk while pointing.** Hold a key on a selected element and speak: the dictated text
  becomes an Ask Claude scoped to that element (Claude Design's "click on an element and speak").

### Epic 17 — Claude Code and repositories

_Demo: in Claude Code, run the Greenfield sync in a React repo; the workspace's design system
updates; a Greenfield frame is built into the repo with one command._

- **17.1 Design sync from code.** A Greenfield CLI command and MCP tool (on 7.7) that reads a
  repository's tokens (CSS variables, Tailwind config, theme files) and React components and
  updates a design system (10.2 does the first import; this keeps it in step). AC: a re-run with
  no code changes makes no changes; a changed token shows up as a reviewable update (10.6).
- **17.2 Sync on push.** Optionally run 17.1 from a GitHub Action or app on pushes to the main
  branch, opening a design-system update for review in Greenfield. AC: never publishes without a
  reviewer.
- **17.3 Greenfield skill for Claude Code.** A Claude Code skill or plugin: list files, open a
  frame's handoff bundle (7.6), build it into the current repo, and push a running screen back
  as a reference image. AC: one instruction ("build the Pricing frame") gets from a Greenfield
  link to a PR-ready change in a typical Next.js repo.
- **17.4 Code-backed components.** Map Greenfield components to code components (FigCraft's Code
  Connect), so generated code imports the real component. AC: mappings are edited in Greenfield
  and read by 7.2's code output and 7.6's bundle.

### Epic 18 — Multiplayer and group chat

_Demo: two teammates edit the same file live, see each other's cursors, and both talk to Claude
in one conversation._ Replaces the soft edit lock (3.4) for files where it's on.

- **18.0 Spike.** Evaluate FigCraft's live sessions and `figcraft-server` for hosted use: auth
  with our sessions, persistence to Blob, scale per file, cost on Vercel or elsewhere (WebSockets
  can't run on Vercel Functions, SPEC D6). AC: an ADR with a hosting choice and numbers.
- **18.1 Live editing.** People in a file see cursors, selections and edits live; per-user
  undo; offline edits reconcile on reconnect. AC: no lost edits in a two-person test; the soft
  lock remains available per file.
- **18.2 Group chat with Claude.** One agent conversation per file that everyone in it sees;
  messages are signed; Claude's turns are queued, each acting for the person who asked and with
  their permissions. AC: two people asking at once get two ordered turns, not interleaved edits.
- **18.3 Cursor chat and spotlight.** FigCraft's cursor chat and "follow me" in our chrome.
- **18.4 Claude in the live session.** Claude's presence (2.4) is shared with everyone in the
  session, not only the person who asked.

### Epic 19 — More exports

- **19.1 ZIP export.** One archive with every frame as PNG and SVG, the standalone HTML (7.5),
  generated code (7.2) and the handoff bundle (7.6). AC: opens offline; a manifest lists what is
  inside.
- **19.2 Google Slides export.** Decks (13.2) export to Google Slides through the user's Google
  connection: text stays editable, images for anything Slides can't draw. AC: speaker notes carry
  over; fonts fall back to the closest Google font with a report.
- **19.3 Export presets.** Saved export settings per file (formats, scales, suffixes), runnable
  by Viewers.

### Epic 20 — Send to other tools

_Demo: "Send to" a frame to Canva, or publish a prototype to Vercel, from the Share menu._

- **20.1 Connections.** Workspace-level OAuth connections to outside tools, with tokens
  encrypted like provider credentials (`@greenfield/crypto`, AAD = workspace id), shown only as
  connected / last used. AC: revoking removes the token; nothing is sent without a connection
  the user can see.
- **20.2 Send to Canva.** Frames as editable designs where Canva's import allows, images
  otherwise. AC: one click from Share › Send to; the result's link comes back into the file's
  activity.
- **20.3 Publish to the web.** Send a prototype's standalone HTML (7.5) to Vercel or Netlify, and
  the handoff bundle to v0, Lovable, Replit or Base44 where they accept one. AC: each target
  says exactly what is sent before sending.
- **20.4 More targets on demand.** Adobe, Miro, Gamma, HubSpot, Wix and others from Claude
  Design's list, added one at a time as users ask, each as a small adapter on 20.1.

### Epic 21 — Live content in frames (research)

Claude Design's frames are live web pages, so its prototypes can play video, run shaders, show 3D
and call AI. A vector editor can't render those in the design itself. Canvas mode gives us a way
in: the host owns everything around and over the canvas.

- **21.1 Spike: live overlays.** An "embed" layer type holding a URL or an HTML snippet. In Play
  and present mode, the host draws a sandboxed iframe exactly over the layer's bounds (from the
  viewport events, 2.3); in edit mode the layer shows a poster image. AC: an ADR on fidelity
  (scroll, zoom, clipping), security (sandbox, CSP, no access to the app) and export (poster in
  static exports, live in HTML export).
- **21.2 Video and media.** Video and animated images in Play, from uploads, with a poster frame
  on the canvas.
- **21.3 Claude-built live components.** Claude writes the HTML for an embed (a shader
  background, a chart, a 3D object) from a request, previewed live in Play. AC: the code is
  kept with the layer and editable; it never runs outside the sandbox.

### Epic 22 — Phone (research, then build)

- **22.1 Mobile review.** Share links and files open read-only on a phone in a touch viewer:
  pan, zoom, page through frames, Play prototypes. AC: works in mobile Safari and Chrome without
  the editor's full interface.
- **22.2 Comment and ask from a phone.** Leave comments and Ask Claude from the mobile viewer;
  agent jobs (4.5) run while the phone is locked and notify when done. AC: a request made from a
  phone finishes and is reviewable on the desktop.
- **22.3 Spike: editing on a tablet.** Whether canvas mode with a touch-adapted chrome is usable
  on an iPad. AC: an ADR with a go/no-go.
