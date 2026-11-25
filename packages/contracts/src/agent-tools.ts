/**
 * Agent tool contract (Story 1.4). Names, descriptions, input and output schemas shared by both
 * agent runtimes: the interactive path (tools run in the browser through `packages/bridge`) and
 * jobs (the same tools against headless `figcraft-cli`). Nobody else should redefine these.
 *
 * Tool definitions are part of the cached prompt prefix, so they are byte-stable: static text,
 * tools sorted by name, schema keys sorted (`toolDefinitions`).
 */
import { z } from 'zod';
import { runBatchInput } from './batch';
import {
  ASK_FOLLOWUP_DESCRIPTION,
  ASK_FOLLOWUP_TOOL,
  askFollowupInput,
  askFollowupOutput,
  SUGGEST_JOB_DESCRIPTION,
  SUGGEST_JOB_TOOL,
  suggestJobInput,
  suggestJobOutput,
} from './followup';
import { sortKeys } from './stable';
import {
  commentThreadInput,
  commentThreadOutput,
  getNodeInput,
  getNodeOutput,
  getOutlineInput,
  getOutlineOutput,
  getSelectionInput,
  getSelectionOutput,
  listCommandsInput,
  listCommandsOutput,
  renderInput,
  renderOutput,
  runBatchOutput,
} from './tool-schemas';

export const AGENT_RUNTIMES = ['interactive', 'job'] as const;
export type AgentRuntime = (typeof AGENT_RUNTIMES)[number];

/**
 * `read`: reads the document; `mutate`: changes it (one undo step per call); `control`: talks to
 * the person, handled by the runtime instead of the editor.
 */
export type AgentToolKind = 'read' | 'mutate' | 'control';

export interface AgentToolDef<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: I;
  output: O;
  kind: AgentToolKind;
  runtimes: readonly AgentRuntime[];
}

const BOTH = AGENT_RUNTIMES;
const INTERACTIVE = ['interactive'] as const;

function tool<I extends z.ZodType, O extends z.ZodType>(t: AgentToolDef<I, O>) {
  return t;
}

export const AGENT_TOOLS = {
  ask_followup: tool({
    name: ASK_FOLLOWUP_TOOL,
    description: ASK_FOLLOWUP_DESCRIPTION,
    input: askFollowupInput,
    output: askFollowupOutput,
    kind: 'control',
    runtimes: INTERACTIVE,
  }),
  comment_thread: tool({
    name: 'comment_thread',
    description:
      'Read a comment thread on the canvas (the messages, the layer it is pinned to, and its state), and optionally reply in it. ' +
      'Use it when the request came from a comment ("Ask Claude") to read the discussion, and to reply there with a one-line note of what you changed when that helps the people in the thread. ' +
      'Make design changes with run_batch, not here.',
    input: commentThreadInput,
    output: commentThreadOutput,
    kind: 'read',
    runtimes: BOTH,
  }),
  get_node: tool({
    name: 'get_node',
    description:
      'Read one layer as JSON, with its children to `depth`. Use `fields` (or `outline: true`) to keep the result small. ' +
      'Read a layer before editing it unless the context already has it; read a sibling section to reuse its values when you build something new.',
    input: getNodeInput,
    output: getNodeOutput,
    kind: 'read',
    runtimes: BOTH,
  }),
  get_outline: tool({
    name: 'get_outline',
    description:
      'A compact outline of the current page (or of the layers under `root`): ids, names, types and text, nested to `depth`. ' +
      'Use it to find layers by name before reading them with get_node.',
    input: getOutlineInput,
    output: getOutlineOutput,
    kind: 'read',
    runtimes: BOTH,
  }),
  get_selection: tool({
    name: 'get_selection',
    description:
      'Read the layers the user has selected, with their properties and children to `depth`. An empty list means nothing is selected.',
    input: getSelectionInput,
    output: getSelectionOutput,
    kind: 'read',
    runtimes: BOTH,
  }),
  list_commands: tool({
    name: 'list_commands',
    description:
      'Search the editor commands you can use in run_batch, beyond the ones documented in your instructions. ' +
      'Returns each command id, label, whether it is undoable, and its parameter doc (e.g. `{ids?, index}`).',
    input: listCommandsInput,
    output: listCommandsOutput,
    kind: 'read',
    runtimes: BOTH,
  }),
  render: tool({
    name: 'render',
    description:
      'Render layers to a PNG and look at it (document pixels only, no editor UI). After a visible change, render the frame you changed once, check it against the request, and fix what looks wrong with another run_batch.',
    input: renderInput,
    output: renderOutput,
    kind: 'read',
    runtimes: BOTH,
  }),
  run_batch: tool({
    name: 'run_batch',
    description:
      'Change the document: run editor commands in order as ONE undo step, labelled `label`. Put all the changes for a step of the request in one call. ' +
      'The first failing command rolls the whole batch back and nothing changes. ' +
      'A step can name itself with `as`; later steps use its result with {"$ref": name} (its `id`) or {"$ref": name, "field": "ids/0"}, or by position with {"$step": n}. ' +
      'Set properties with node.set rather than deleting and rebuilding layers. ' +
      "New layers are not selected (the selection is the user's): point later steps at them with references. " +
      "Returns each step's result and the layers that were added, removed or changed.",
    input: runBatchInput,
    output: runBatchOutput,
    kind: 'mutate',
    runtimes: BOTH,
  }),
  suggest_generation_job: tool({
    name: SUGGEST_JOB_TOOL,
    description: SUGGEST_JOB_DESCRIPTION,
    input: suggestJobInput,
    output: suggestJobOutput,
    kind: 'control',
    runtimes: INTERACTIVE,
  }),
} as const satisfies Record<string, AgentToolDef>;

export type AgentToolName = keyof typeof AGENT_TOOLS;
export const AGENT_TOOL_NAMES = Object.keys(AGENT_TOOLS).sort() as AgentToolName[];

export type ToolInput<N extends AgentToolName> = z.input<(typeof AGENT_TOOLS)[N]['input']>;
export type ParsedToolInput<N extends AgentToolName> = z.output<(typeof AGENT_TOOLS)[N]['input']>;
export type ToolOutput<N extends AgentToolName> = z.output<(typeof AGENT_TOOLS)[N]['output']>;

export const isAgentTool = (name: string): name is AgentToolName =>
  Object.prototype.hasOwnProperty.call(AGENT_TOOLS, name);

/** Tools available to a runtime, sorted by name (cache-friendly). */
export function toolsFor(runtime: AgentRuntime): AgentToolDef[] {
  return AGENT_TOOL_NAMES.map((k) => AGENT_TOOLS[k] as AgentToolDef).filter((t) =>
    t.runtimes.includes(runtime),
  );
}

// ---------------------------------------------------------------- Anthropic tool definitions

/** An Anthropic Messages API tool definition (structurally `Anthropic.Tool`). */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: { type: 'object'; [k: string]: unknown };
}

/**
 * JSON Schema for a tool input: inlined (no `$defs` indirection for the model to follow), keys
 * sorted, without `$schema` and without the noise Zod adds (safe-integer bounds, string
 * `propertyNames` on records).
 */
export function jsonSchemaFor(schema: z.ZodType): ToolDefinition['input_schema'] {
  const js = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
    reused: 'inline',
  }) as Record<string, unknown>;
  delete js.$schema;
  return sortKeys(tidy(js)) as ToolDefinition['input_schema'];
}

function tidy(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(tidy);
  if (!v || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === 'maximum' && x === Number.MAX_SAFE_INTEGER) continue;
    if (k === 'minimum' && x === Number.MIN_SAFE_INTEGER) continue;
    if (k === 'propertyNames' && JSON.stringify(x) === '{"type":"string"}') continue;
    out[k] = tidy(x);
  }
  return out;
}

export function toToolDefinition(t: AgentToolDef): ToolDefinition {
  return { name: t.name, description: t.description, input_schema: jsonSchemaFor(t.input) };
}

const definitions = new Map<AgentRuntime, readonly ToolDefinition[]>();

/** The tools for a runtime as API tool definitions: sorted by name, byte-stable. */
export function toolDefinitions(runtime: AgentRuntime): readonly ToolDefinition[] {
  let defs = definitions.get(runtime);
  if (!defs) {
    defs = Object.freeze(toolsFor(runtime).map(toToolDefinition));
    definitions.set(runtime, defs);
  }
  return defs;
}
