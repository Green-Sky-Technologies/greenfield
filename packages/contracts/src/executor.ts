/**
 * `executeTool`: run one agent tool call against an `Editor` from `packages/bridge` (the real
 * editor, `MockEditor`, or a headless one for jobs). Client-safe: interactive turns run it in the
 * browser, next to the editor.
 *
 * It validates the input, maps the call onto the bridge, validates the output, and returns
 * tool-result content. Model mistakes and editor refusals come back as typed errors
 * (`ToolErrorKind`), never as exceptions; only programming errors throw.
 *
 * Control tools (`ask_followup`, `suggest_generation_job`) are validated and handed back in
 * `control` for the runtime to act on: they don't touch the editor.
 */
import {
  BridgeError,
  bytesToBase64,
  CommandError,
  diffSnapshots,
  flatten,
  type BatchStep,
  type CallOptions,
  type DocumentInfo,
  type Editor,
  type NodeId,
  type NodeRecord,
} from '@greenfield/bridge';
import type { z } from 'zod';
import {
  AGENT_TOOLS,
  isAgentTool,
  type AgentRuntime,
  type AgentToolName,
  type ParsedToolInput,
  type ToolOutput,
} from './agent-tools';
import { agentCommandBlocked, keepSelection } from './batch';
import { LAYOUT_DERIVED, layerChanges, topFrame, type LayerChange } from './changes';
import { SUGGEST_JOB_RESULT, type JobSuggestion, type QuestionSet } from './followup';
import { stableStringify } from './stable';

/** Tool-result content blocks (structurally the Anthropic SDK's text and image block params). */
export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } };

/**
 * - `unknown_tool`: no such tool, or not in this runtime.
 * - `validation`: the input doesn't fit the schema (unknown command or parameter, bad reference,
 *   a command outside the allow-list, …). Nothing ran.
 * - `not_found`: a layer id that doesn't exist.
 * - `command`: the editor refused (`CommandError`); a batch was rolled back.
 * - `hidden`: the editor tab is hidden (`EditorHiddenError`); nothing ran, retry when visible.
 * - `timeout`: no answer in time; a mutation may still have applied.
 * - `unavailable`: the editor isn't ready, has no document, or failed to start.
 * - `scope`: `run_batch` changed layers outside `ToolContext.scope`; the batch was undone.
 */
export type ToolErrorKind =
  | 'unknown_tool'
  | 'validation'
  | 'not_found'
  | 'command'
  | 'hidden'
  | 'timeout'
  | 'unavailable'
  | 'scope';

export interface ToolError {
  kind: ToolErrorKind;
  message: string;
  /** The editor command that failed (`command` errors). */
  command?: string;
}

export type ToolControl =
  | { tool: 'ask_followup'; input: QuestionSet }
  | { tool: 'suggest_generation_job'; input: JobSuggestion };

export type ToolOutcome =
  | {
      ok: true;
      name: AgentToolName;
      /** The validated output (undefined for `ask_followup`, whose result is the user's answer). */
      output: unknown;
      content: ToolContent[];
      isError: false;
      /** Layers this call added, removed or changed (`run_batch` only). */
      touched: NodeId[];
      /** `run_batch`: what changed, property by property (Story 4.7). Not sent to the model. */
      changes?: LayerChange[];
      /** `run_batch`: the top-level frames the changes are in (what a self-check renders). */
      frames?: NodeId[];
      /** Set for control tools: the runtime ends the turn or shows the offer. */
      control?: ToolControl;
    }
  | {
      ok: false;
      name: string;
      error: ToolError;
      content: ToolContent[];
      isError: true;
      touched: [];
    };

export interface ToolContext {
  /** Default `interactive`. Tools outside the runtime are `unknown_tool`. */
  runtime?: AgentRuntime;
  /** Restrict `run_batch` to these commands (on top of the blocked families). */
  allowedCommands?: Iterable<string>;
  /** Author for `comment_thread` replies. Default `Claude`. */
  author?: string;
  /** Tool-result text is cut at this many characters. Default 40,000. */
  maxTextChars?: number;
  /** Passed to every bridge call (timeouts). */
  call?: CallOptions;
  /**
   * Run edits as this agent (`run_batch`, comment replies): the editor outlines
   * the layers they change with the agent's presence (Story 2.4). Unset: they run as the user.
   */
  agent?: string;
  /**
   * Layers a scoped request may change, with their descendants (Story 4.2). A `run_batch` that
   * adds, removes or changes anything else is undone (`edit.undo`) and fails with `scope`.
   */
  scope?: readonly NodeId[] | null;
}

const DEFAULT_MAX_TEXT = 40_000;
/** `document.inspect`'s maximum depth: the whole page for the change set. */
const FULL_DEPTH = 64;

class ToolFailure extends Error {
  constructor(
    readonly kind: ToolErrorKind,
    message: string,
    readonly command?: string,
  ) {
    super(message);
  }
}

const text = (t: string): ToolContent => ({ type: 'text', text: t });

function clip(s: string, max: number): string {
  return s.length > max
    ? `${s.slice(0, max)}\n…(truncated: ask for less with fields, depth or outline)`
    : s;
}

function failure(name: string, error: ToolError): ToolOutcome {
  return {
    ok: false,
    name,
    error,
    content: [text(stableStringify({ error }))],
    isError: true,
    touched: [],
  };
}

function fromBridgeError(e: BridgeError): ToolError {
  switch (e.code) {
    case 'command':
      return { kind: 'command', message: e.message, command: (e as CommandError).command };
    case 'hidden':
      return { kind: 'hidden', message: e.message };
    case 'timeout':
      return {
        kind: 'timeout',
        message: `${e.message} A change may still have applied: read the layers before retrying.`,
      };
    default:
      return { kind: 'unavailable', message: e.message };
  }
}

function issueText(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

/** Run one tool call. Never throws for model mistakes or editor refusals. */
export async function executeTool(
  name: string,
  input: unknown,
  editor: Editor,
  ctx: ToolContext = {},
): Promise<ToolOutcome> {
  const runtime = ctx.runtime ?? 'interactive';
  if (!isAgentTool(name))
    return failure(name, { kind: 'unknown_tool', message: `Unknown tool: ${name}` });
  const def = AGENT_TOOLS[name];
  if (!(def.runtimes as readonly string[]).includes(runtime))
    return failure(name, {
      kind: 'unknown_tool',
      message: `${name} is not available in ${runtime === 'job' ? 'a background job' : 'this conversation'}.`,
    });
  const parsed = (def.input as z.ZodType).safeParse(input);
  if (!parsed.success)
    return failure(name, {
      kind: 'validation',
      message: `Invalid input for ${name}: ${issueText(parsed.error)}`,
    });
  try {
    const r = await run(name, parsed.data as never, editor, ctx);
    const out = (def.output as z.ZodType).safeParse(r.output);
    if (r.output !== undefined && !out.success)
      throw new Error(`${name} produced an invalid output: ${issueText(out.error)}`);
    const max = ctx.maxTextChars ?? DEFAULT_MAX_TEXT;
    return {
      ok: true,
      name,
      output: r.output === undefined ? undefined : out.data,
      content: [
        ...(r.image ? [r.image] : []),
        ...(r.text !== undefined
          ? [text(r.text)]
          : r.output !== undefined
            ? [text(clip(stableStringify(out.data), max))]
            : []),
      ],
      isError: false,
      touched: r.touched ?? [],
      ...(r.changes ? { changes: r.changes, frames: r.frames ?? [] } : {}),
      ...(r.control ? { control: r.control } : {}),
    };
  } catch (e) {
    if (e instanceof ToolFailure)
      return failure(name, {
        kind: e.kind,
        message: e.message,
        ...(e.command ? { command: e.command } : {}),
      });
    if (e instanceof BridgeError) {
      const error = fromBridgeError(e);
      if (name === 'run_batch' && error.kind === 'command')
        error.message = `${error.message.replace(/\.?$/, '.')} The whole batch was rolled back: nothing changed.`;
      return failure(name, error);
    }
    throw e;
  }
}

interface RunResult {
  output: unknown;
  text?: string;
  image?: ToolContent;
  touched?: NodeId[];
  changes?: LayerChange[];
  frames?: NodeId[];
  control?: ToolControl;
}

async function run<N extends AgentToolName>(
  name: N,
  input: ParsedToolInput<N>,
  editor: Editor,
  ctx: ToolContext,
): Promise<RunResult> {
  const call = ctx.call;
  switch (name) {
    case 'get_selection': {
      const i = input as ParsedToolInput<'get_selection'>;
      const doc = await editor.inspect({ depth: 0, fields: [] }, call);
      const selection = [];
      for (const id of doc.selection) {
        const n = await editor.getNode(
          id,
          { depth: i.depth, ...(i.fields ? { fields: i.fields as never } : {}) },
          call,
        );
        if (n) selection.push(n);
      }
      return { output: { page: doc.currentPage, selection } satisfies ToolOutput<'get_selection'> };
    }
    case 'get_outline': {
      const i = input as ParsedToolInput<'get_outline'>;
      if (i.root !== undefined) {
        const node = await editor.getNode(i.root, { depth: i.depth, outline: true }, call);
        if (!node) throw new ToolFailure('not_found', `No layer ${i.root}`);
        const doc = await editor.inspect({ depth: 0, fields: [] }, call);
        return { output: { page: doc.currentPage, outline: node } };
      }
      const doc = await editor.inspect({ depth: i.depth, outline: true }, call);
      const page = doc.pages.find((p) => p.id === doc.currentPage);
      if (!page) throw new ToolFailure('not_found', 'The current page is missing');
      return { output: { page: doc.currentPage, outline: page } };
    }
    case 'get_node': {
      const i = input as ParsedToolInput<'get_node'>;
      const node = await editor.getNode(
        i.id,
        {
          depth: i.depth,
          ...(i.fields ? { fields: i.fields as never } : {}),
          ...(i.outline ? { outline: true } : {}),
        },
        call,
      );
      if (!node) throw new ToolFailure('not_found', `No layer ${i.id}`);
      return { output: { node } };
    }
    case 'run_batch': {
      const i = input as ParsedToolInput<'run_batch'>;
      const allowed = ctx.allowedCommands ? new Set(ctx.allowedCommands) : null;
      if (allowed)
        for (const s of i.commands) {
          const why = agentCommandBlocked(s.command, allowed);
          if (why) throw new ToolFailure('validation', `Invalid input for run_batch: ${why}`);
        }
      const before = pageRecords(await editor.inspect({ depth: FULL_DEPTH }, call));
      const results = await editor.batch(keepSelection(i.commands) as unknown as BatchStep[], {
        label: i.label,
        ...call,
        agent: ctx.agent,
      });
      // The batch has applied: from here on, never report a failure (the model would retry it).
      const after = await editor
        .inspect({ depth: FULL_DEPTH }, call)
        .then(pageRecords)
        .catch(() => null);
      const changes = after ? diffSnapshots(before, after) : null;
      const touched = new Set<NodeId>(
        changes ? [...changes.added, ...changes.removed, ...changes.changed.map((c) => c.id)] : [],
      );
      // A command that set a value to what it already was still targeted that layer.
      const targeted = new Set<NodeId>();
      for (const s of i.commands)
        for (const id of targetIds(s.params))
          if (before.has(id) || after?.has(id)) targeted.add(id);
      for (const id of targeted) touched.add(id);
      if (ctx.scope?.length) {
        // Auto layout moves and resizes ancestors and siblings of whatever changed: those are
        // not edits. What counts is what the batch added, removed or set, and what it targeted.
        const edited = new Set<NodeId>(
          changes
            ? [
                ...changes.added,
                ...changes.removed,
                ...changes.changed
                  .filter((c) => c.fields.some((f) => !LAYOUT_DERIVED.has(f)))
                  .map((c) => c.id),
              ]
            : [],
        );
        for (const s of i.commands)
          for (const id of targetIds(s.params))
            if (before.has(id) || after?.has(id)) edited.add(id);
        const outside = outOfScope(edited, ctx.scope, before, after);
        if (outside.length) await undoOutOfScope(editor, i.label, outside, ctx.scope, call);
      }
      const records = after ? layerChanges(before, after, targeted) : [];
      const frames = new Set<NodeId>();
      for (const c of records) if (c.frame != null) frames.add(c.frame);
      for (const id of targeted) {
        const f = after?.has(id) ? topFrame(after, id) : null;
        if (f != null) frames.add(f);
      }
      return {
        output: { label: i.label, results, changes } satisfies ToolOutput<'run_batch'>,
        touched: [...touched].sort((a, b) => a - b),
        changes: records,
        frames: [...frames].sort((a, b) => a - b),
      };
    }
    case 'render': {
      const i = input as ParsedToolInput<'render'>;
      const r = await editor.render({ ...(i.ids ? { ids: i.ids } : {}), scale: i.scale }, call);
      const output = { ids: i.ids ?? null, width: r.width, height: r.height };
      return {
        output,
        image: {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: bytesToBase64(r.png) },
        },
      };
    }
    case 'list_commands': {
      const i = input as ParsedToolInput<'list_commands'>;
      const allowed = ctx.allowedCommands ? new Set(ctx.allowedCommands) : null;
      const words = (i.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const matches = (await editor.commands(call))
        .filter((c) => !agentCommandBlocked(c.id, allowed))
        .filter((c) => {
          const hay = `${c.id} ${c.label}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        })
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return {
        output: {
          total: matches.length,
          commands: matches.slice(0, i.limit).map((c) => ({
            id: c.id,
            label: c.label,
            params: c.params,
            undoable: c.undoable,
          })),
        } satisfies ToolOutput<'list_commands'>,
      };
    }
    case 'comment_thread': {
      const i = input as ParsedToolInput<'comment_thread'>;
      const thread = await editor.execute('comment.prompt', { ids: [i.threadId] }, call);
      if (i.reply !== undefined)
        await editor.execute(
          'comment.reply',
          { id: i.threadId, text: i.reply, author: ctx.author ?? 'Claude' },
          { ...call, agent: ctx.agent },
        );
      return { output: { thread, replied: i.reply !== undefined } };
    }
    case 'ask_followup':
      return {
        output: undefined,
        control: { tool: 'ask_followup', input: input as QuestionSet },
      };
    case 'suggest_generation_job':
      return {
        output: { status: 'offered' } satisfies ToolOutput<'suggest_generation_job'>,
        text: SUGGEST_JOB_RESULT,
        control: { tool: 'suggest_generation_job', input: input as JobSuggestion },
      };
  }
  throw new Error(`No executor for ${String(name)}`);
}

/**
 * Touched layers that are not a scope layer or inside one, before or after the batch (a layer
 * moved out of the scope counts, as does one created next to it).
 */
export function outOfScope(
  touched: Iterable<NodeId>,
  scope: readonly NodeId[],
  before: Map<NodeId, NodeRecord>,
  after: Map<NodeId, NodeRecord> | null,
): NodeId[] {
  const roots = new Set(scope);
  const inside = (records: Map<NodeId, NodeRecord>, id: NodeId) => {
    for (let cur: NodeId | null | undefined = id, n = 0; cur != null && n < 256; n++) {
      if (roots.has(cur)) return true;
      cur = records.get(cur)?.parent as NodeId | null | undefined;
    }
    return false;
  };
  const out: NodeId[] = [];
  for (const id of touched) {
    const okBefore = !before.has(id) || inside(before, id);
    const okAfter = !after?.has(id) || inside(after, id);
    if (!okBefore || !okAfter) out.push(id);
  }
  return out.sort((a, b) => a - b);
}

/** Undo the batch just applied (only if it is still the newest undo step) and fail with `scope`. */
async function undoOutOfScope(
  editor: Editor,
  label: string,
  outside: NodeId[],
  scope: readonly NodeId[],
  call: CallOptions | undefined,
): Promise<never> {
  const where = `layers ${scope.join(', ')} and their descendants`;
  const doc = await editor.inspect({ depth: 0, fields: [] }, call).catch(() => null);
  const undone =
    doc?.history.undo[0] === label &&
    (await editor
      .execute('edit.undo', {}, call)
      .then((r) => (r as { undone?: unknown } | null)?.undone !== false)
      .catch(() => false));
  throw new ToolFailure(
    'scope',
    undone
      ? `This batch changed layers outside the scope (${outside.join(', ')}), so it was undone: nothing changed. Only change ${where}.`
      : `This batch changed layers outside the scope (${outside.join(', ')}) and could not be undone. Read those layers and restore them; only change ${where}.`,
  );
}

function pageRecords(doc: DocumentInfo): Map<NodeId, NodeRecord> {
  return flatten(doc.pages.find((p) => p.id === doc.currentPage));
}

/** Literal layer ids a step targets (`id` / `ids`; references resolve inside the editor). */
function targetIds(params: Record<string, unknown> | undefined): NodeId[] {
  if (!params) return [];
  const ids = [params.id, ...(Array.isArray(params.ids) ? params.ids : [])];
  return ids.filter((x): x is number => typeof x === 'number' && Number.isInteger(x));
}
