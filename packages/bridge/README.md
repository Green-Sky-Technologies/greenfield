# @greenfield/bridge

The only way app code talks to the editor (SPEC §1, D21; Story 1.3). A typed client over the
embedded FigCraft editor's two channels:

- **Host messages** (`?host=parent`, postMessage): `figcraft:ready`, `open`, `dirty`, `save`,
  `failed`, and `figcraft:event` (`onEvent`: selection, document patches, tool, text editing,
  viewport, interaction, presence, canvas mode, `ui.request`; shapes in `src/events.ts`).
- **Control** (`?control`, the same-origin iframe's `window.figcraft`): commands,
  `document.inspect`, `node.get`, `ui.render`, `engine.commands`.

Framework-free TypeScript source (no React, no Next). Three implementations share one `Editor`
interface (`src/types.ts`):

|                                 | Import                          | Use                                      |
| ------------------------------- | ------------------------------- | ---------------------------------------- |
| `createBridge({ iframe })`      | `@greenfield/bridge`            | the real editor in the app               |
| `MockEditor`                    | `@greenfield/bridge/mock`       | unit tests (in memory)                   |
| `RemoteEditor` / `test` fixture | `@greenfield/bridge/playwright` | Playwright tests against the real editor |

Pinned editor: **figcraft-web 0.18.1**, set once in [`editor-release.json`](editor-release.json)
(`version`, the download `url` and the `sha256` of the zip). Our fork,
[`Green-Sky-Technologies/greenfield-editor`](https://github.com/Green-Sky-Technologies/greenfield-editor),
publishes a release on every push to its `main` (tag `editor-<short sha>`) and prints the three
pin values in the run summary. `node apps/web/scripts/fetch-editor.mjs` downloads the pinned release into `apps/web/public/editor`; the
generated `EDITOR_VERSION` and `EDITOR_RELEASE_SHA256` must match it (`test/csp.test.ts` fails
otherwise). To upgrade, change the pin, fetch, then `generate`.

`@greenfield/bridge/csp` holds the content security policies for `/editor/` and the pages that
embed it (Story 8.1); `next.config.ts` and the test server send the same ones.

## Using it

```ts
import { createBridge, ref, EditorHiddenError } from '@greenfield/bridge';

const editor = createBridge({ iframe, author: user.name }); // sets iframe.src after it listens
editor.onSave(async ({ name, bytes, saveAs }) => upload(name, bytes, saveAs));
editor.onDirty((dirty) => setUnsaved(dirty));
await editor.ready();
editor.open('Landing.figcraft', bytes);

await editor.batch(
  [
    {
      command: 'node.create',
      as: 'card',
      params: { type: 'frame', name: 'Card', props: { layout: 'vertical', gap: 12 } },
    },
    { command: 'node.create', params: { type: 'text', parent: ref('card'), text: 'Ada Lovelace' } },
  ],
  { label: 'Add card' }, // one undo step
);
const { png, width, height } = await editor.render({ ids: [frameId], scale: 0.5 });
```

### API

Lifecycle and host messages

| Member               |                                                                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isReady`, `ready()` | `figcraft:ready` arrived; `ready()` rejects with `EditorFailedError` on `figcraft:failed`                                                                                                                              |
| `onReady(cb)`        | once per load; called at once if already ready                                                                                                                                                                         |
| `onDirty(cb)`        | unsaved changes appeared / went away                                                                                                                                                                                   |
| `onSave(cb)`         | `{name, bytes, saveAs, id?}` for every file the editor hands over (Save, Save As, exports). Return a promise: when the editor sends an `id` (a future fork patch) the bridge answers `figcraft:saved` after it settles |
| `onEvent(cb)`        | `figcraft:event`, typed `EditorEvent` narrowed on `name` (`src/events.ts`); at most once a frame each. Panels read these, never poll (ADR 0005)                                                                        |
| `onFailed(cb)`       | the editor couldn't start (no WebGPU or WebGL2)                                                                                                                                                                        |
| `open(name, bytes)`  | `figcraft:open`. The bytes are copied, never transferred away from the caller. Applies on a later frame (poll `inspect()` for the new document)                                                                        |
| `save()`             | presses Save the way the platform does: Cmd+S when the user agent is a Mac, Ctrl+S elsewhere (`ui.key {ctrl}` on a Mac is the Control key and saves nothing)                                                           |
| `dispose()`          | stop listening and polling                                                                                                                                                                                             |

Control

| Member                                        | Editor call                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `execute(command, params)`                    | `engine.execute`; `params` typed per command (generated)                                                                                               |
| `batch(steps, {label})`                       | `command.batch`: one undo step; `as` + `ref(name, field?)` / `step(n, field?)` references; the first failure rolls back the whole batch                |
| `batchContinue(steps)`                        | `command.batch` with `onError: 'continue'`: per-step `{step, command, ok, result \| error}`                                                            |
| `inspect({depth, fields, outline, allPages})` | `document.inspect` (`fields` typed as `NodeField`)                                                                                                     |
| `getNode(id, {depth, fields, outline})`       | `node.get`; `null` for a missing layer                                                                                                                 |
| `render({ids, scale})`                        | `ui.render`: document pixels only, deterministic, no GPU readback. `{png, width, height}`. There is deliberately no `screenshot` (it hangs; Story 0.4) |
| `commands()`                                  | `figcraft.commands()`                                                                                                                                  |
| `request(method, params)`                     | any control method, untyped (escape hatch)                                                                                                             |

Every control call takes `{ timeoutMs }` (default 35 s; the editor itself gives up after 30 s).

### Comments (Story 6.1)

Comment threads live in the `.figcraft` file (D23). Typed helpers over `comment.*`:
`addComment(editor, {x, y, text, anchor?, author?})`, `replyToComment`, `resolveComment`,
`deleteComment` and `listComments` (`CommentThread[]`: page, `anchor` layer, pin `x`/`y`, author,
replies, mentions, resolved). A thread pinned to a layer stores its offset from that layer, so it
follows the layer when it moves. Thread ids are per document and reused after a delete; only a
message's author may edit or delete it (pass `author` to act as someone else).

`readFileComments(bytes)` from `@greenfield/bridge/file` reads the threads out of saved bytes
without an editor (the zip's `document.json`, format `figcraft` version 1); the server mirrors
them into `comment_index` on every save. It returns null for anything else.

### Errors

All extend `BridgeError` (`code` in parentheses):

- `EditorHiddenError` (`hidden`): the tab is hidden. Every `window.figcraft` call waits for a frame
  and hidden tabs draw none, so the bridge refuses up front instead of hanging 30 s. Retry when
  visible.
- `EditorNotReadyError` (`not_ready`): before `figcraft:ready`, after `dispose`, after a failed
  start, or `window.figcraft` missing.
- `NoDocumentError` (`no_document`): host mode starts on the home screen; nothing is open until
  `open()` or `file.new`.
- `CommandError` (`command`): the editor refused (`editorMessage` verbatim, `command`, `method`),
  e.g. ``unknown parameter `bogus` (it takes type, x, …)``.
- `EditorTimeoutError` (`timeout`): no answer in time. A call the editor had started can't be
  stopped and may still apply: check the document before retrying a mutation.
- `EditorFailedError` (`failed`): `figcraft:failed`.

### Change detection (`onChange`, `detectChanges`)

Until the fork posts change events (Story 2.3), the bridge polls (Story 0.4 (b)):

1. **Gate** every 400 ms: `document.inspect {depth: 0, fields: []}` (~17 ms, < 0.5 KiB at any
   size), keyed on document id, page, undo history and page child counts. Selection and dirty
   changes come from the gate alone.
2. **Full diff** of the current page with `DIFF_FIELDS` (geometry, style, text, structure): 300 ms
   after the gate changes (a drag gives one diff), on demand with `detectChanges()` (call it before
   each agent turn), and as a backstop every 7.5 s for the gate's blind spots (an undo followed by
   an edit with the same label).

`onChange` yields `{added, removed, changed: {id, fields}[], meta, controlEdits}`; `controlEdits`
is how many `execute`/`batch` calls this bridge made since the last snapshot (0 = a person's
edit). Polling runs only while someone listens, pauses while the tab is hidden and resumes when
it's shown; a document or page switch resets the snapshot. Tune with
`createBridge({ changes: { gateIntervalMs, debounceMs, backstopMs, fields, onError } })`.

## Generated command types

`src/generated/commands.ts` (committed) comes from the pinned editor:

```sh
node spikes/0.1-embed/fetch-editor.mjs              # once
pnpm --filter @greenfield/bridge generate           # rewrite the file
pnpm --filter @greenfield/bridge check:commands     # CI: fail if the editor's commands changed
```

The script loads the release headlessly (Playwright Chromium, port 3103), reads
`figcraft.commands()`, and asks the engine which parameters each command takes: an unknown
parameter is refused before anything runs, with the list (`… (it takes type, x, y, …)`). The
editor's parameter doc (`{type: rectangle|ellipse, x?, parent? (id), …}`) then supplies
optionality, enums, shapes and the TSDoc comments; a short table of well-known names (`x` is a
number, `name` a string, `ids` layer ids in layer namespaces) fills in the rest.

For 0.18.1: **643 commands, all with exact key lists** (no `Record<string, unknown>` fallback);
**821 of the engine's 1,445 parameters have a concrete type**, 624 are `unknown` (documented in
TSDoc); `node.set` takes `NodeProps` (112 props, 69 typed). `id`/`ids` are accepted by every
command. Unknown keys are type errors, as they are errors in the editor. `NODE_FIELDS` (the
`fields` keys), `NODE_SET_PROPS`, `COMMANDS` (the full metadata, with `takes`),
`COMMANDS_HASH` and `COMMAND_COUNT` are exported too.

`check:commands` regenerates in memory and fails when the hash or version differs from the
committed file (or the generator's output changed). The command list doesn't depend on the
browser's platform (checked with Mac, Linux and Windows user agents).

## MockEditor

```ts
import { MockEditor } from '@greenfield/bridge/mock';
const editor = new MockEditor(); // ready, with an untitled document
await editor.execute('node.create', { type: 'frame', name: 'Card' }); // → { id: 2 }
```

An in-memory layer tree with the real editor's shapes and messages: `file.new`, `node.create`,
`node.set` (`props` or flat; `fill`/`stroke` shorthands), `text.set`, `edit.delete`, `select.set`,
`command.batch` (refs, field paths, rollback, `onError: 'continue'`), `document.inspect`
(`depth`, `fields`, `outline`), `node.get`, `ui.render` (a 1×1 PNG), `engine.commands` (the full
pinned list), `ui.key` Save. Ids are deterministic (page 1, layers from 2). Parameters are checked
against the pinned key lists. Other commands reject with "MockEditor doesn't implement …".
Saves produce bytes that `open()` restores exactly; other bytes open an empty document.

Options: `ready: false` (then `makeReady()`), `document: false` (start on the home screen),
`platform`, `changes`. Test hooks: `setHidden(bool)`, `fail(error)`, `userExecute()` (an edit by
"a person", not counted in `controlEdits`), `calls`.

FigCraft has no `node.delete`: deletion is `edit.delete {ids}`.

## Playwright helper

```ts
import { test, expect } from '@greenfield/bridge/playwright';

test('builds a card', async ({ editor }) => {
  await editor.execute('file.new', {});
  await editor.batch([...]);
  const saved = await editor.nextSave(() => editor.pressSave()); // real Meta/Control+S
});
```

The `editor` fixture opens a host page (default `/__bridge/host.html`, relative to `baseURL`)
that embeds `/editor/index.html?host=parent&control&author=…` with `createBridge`, waits for
ready, and returns a `RemoteEditor`: the same `Editor` interface driven from Node through the
real bridge in the page (typed errors and bytes cross over). Extras: `pressSave()`,
`setHidden(bool)` (Playwright keeps pages visible, so this overrides `visibilityState`),
`nextSave(fn)`, `saves`, `dirtyLog`, `frame()`, `openAndWait()`. `openEditor(page, options)`
opens another (a reload). Options (`test.use({ editorOptions })`): `author`, `webgl` (default
`true`: headless browsers may offer WebGPU without an adapter, and the editor never starts),
`gateIntervalMs`, `debounceMs`, `backstopMs`, `hostPath`, `readyTimeoutMs`.

Serve the host and the editor with `startHostServer()` from `@greenfield/bridge/playwright/server`
or `pnpm --filter @greenfield/bridge serve` (port 3103). Another host page works if it sets
`window.__greenfieldBridge = { editor, iframe }` (see `src/playwright/host-entry.ts`).

## Tests

```sh
pnpm --filter @greenfield/bridge test     # unit: mock, host messages, control, detector, generator
pnpm --filter @greenfield/bridge e2e      # real editor in Chromium, WebKit and Firefox (port 3103)
```

The e2e suite covers comments (a pin follows its layer when it moves, before and after a save
and reopen; the saved file carries the threads), execute, batch (references, one undo step, rollback, continue), typed
errors, inspect, render, open → edit → save → reopen (including the platform save chord),
change detection of a control-channel edit, and `EditorHiddenError`.
