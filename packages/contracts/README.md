# @greenfield/contracts

Shapes shared across runtimes. Zod only, plus `@greenfield/bridge` for the editor's types and
pinned command list; client-safe.

- **Agent tools** (Story 1.4): the tools the model sees, one definition for the interactive path
  and for jobs.
- **Jobs** (`job-runner.ts`): job kinds, inputs, statuses and the `JobRunner` interface.

## Agent tools

| Tool                     | Kind    | Runtimes    | What it does                                                                                 |
| ------------------------ | ------- | ----------- | -------------------------------------------------------------------------------------------- |
| `get_selection`          | read    | both        | The selected layers (`node.get` each, to `depth`, optional `fields`)                         |
| `get_outline`            | read    | both        | Outline of the current page or of `root` (ids, names, types, text)                           |
| `get_node`               | read    | both        | One layer with children to `depth`; `fields` or `outline` keep it small                      |
| `run_batch`              | mutate  | both        | `{label, commands: [{command, params?, as?}]}` as one undo step (the bridge's `batch`)       |
| `render`                 | read    | both        | `ui.render` of `ids` at `scale` (≤ 2), returned as an image block                            |
| `list_commands`          | read    | both        | Search the pinned commands the agent may use                                                 |
| `comment_thread`         | read    | both        | Read a comment thread (`comment.prompt`), optionally reply as the agent (Ask Claude, Epic 6) |
| `ask_followup`           | control | interactive | Question card (Story 4.4); ends the turn, the user's answer is the result                    |
| `suggest_generation_job` | control | interactive | Offer a background job (Story 4.5) instead of editing                                        |

- `AGENT_TOOLS` holds each tool's `input` and `output` schema, `kind` and `runtimes`;
  `toolsFor(runtime)` and `toolDefinitions(runtime)` (Anthropic tool definitions: sorted by
  name, keys sorted, inlined JSON Schema) are what the prompt prefix uses. The definitions are
  snapshotted byte for byte in `src/__snapshots__/tool-definitions.json`: they are the start of
  the cached prefix, so any change there is a cache miss for every conversation.
- **`run_batch` validation**, before anything reaches the editor: each `command` is in the
  bridge's generated `COMMANDS`, and not in a blocked family (`AGENT_BLOCKED_PREFIXES`: files,
  app/window/view/tool chrome, prefs, collab, versions, branches, export, plugins, comments;
  plus `command.batch`, `edit.undo`, `edit.redo`); `params` keys are ones the command takes
  (`node.set`: `NODE_SET_PROPS`); `as` names are unique; every `{"$ref": name}` /
  `{"$step": n}` (optional `field`, e.g. `"ids/0"`) points at an earlier step. Pass
  `allowedCommands` to `executeTool` for a stricter allow-list. `COMMAND_REFERENCE` is the
  curated list the prompt documents (Story 0.3), not an allow-list.

### Executing

```ts
import { executeTool } from '@greenfield/contracts';

const r = await executeTool(toolUse.name, toolUse.input, editor, { runtime: 'interactive' });
// r.content → tool_result content; r.isError; r.touched (layer ids run_batch changed)
// r.ok ? r.output : r.error.kind
// r.control → ask_followup / suggest_generation_job for the loop to act on
```

`editor` is any bridge `Editor`: `createBridge` in the browser, `MockEditor` in tests, a headless
editor in jobs. Errors come back as results, never exceptions: `unknown_tool`, `validation`
(nothing ran), `not_found`, `command` (the editor refused; a batch rolled back), `hidden` (the
tab is hidden; nothing ran), `timeout` (a mutation may still have applied), `unavailable` (not
ready, no document, failed). `run_batch` diffs the current page before and after (until Story
2.3 events) and returns `changes: {added, removed, changed}`; once the batch has applied it never
reports a failure, so a model never retries an applied edit.

### Testing

`@greenfield/contracts/testing` has the `landing` golden fixture (`buildLanding(editor)`), the
golden case schema and `checkScope`. `src/golden.test.ts` replays scripted tool calls for every
case in `evals/golden/interactive.json` against `MockEditor` (see `evals/README.md`).
