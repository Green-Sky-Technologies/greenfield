/**
 * Agent turns: Messages API + tool use, streamed. A manual loop (not the SDK tool runner)
 * because every call goes through the metered LLM proxy, tools run on a host outside this
 * process (the browser editor for interactive turns, Story 4.2; figcraft-cli for jobs), and
 * partial output is persisted for SSE.
 *
 * `runAgentStep` is one model call: it streams the reply, handles the control tools
 * (`ask_followup`, `suggest_generation_job`) and invalid calls itself, and hands back the calls a
 * host must run. The interactive path runs one step per request and waits for the browser's
 * results in between; `runAgentTurn` loops steps against an in-process `ToolHost`.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentRuntime } from '@greenfield/contracts';
import { checkToolCall, executeTool, type ToolHost, type ToolResult } from './tools';
import { SUGGEST_JOB_TOOL, suggestJobInput, type JobSuggestion, type Prefix } from './prefix';
import { ASK_FOLLOWUP_TOOL, askFollowupInput, type QuestionSet } from './questions';

export type MessageStreamParams = Omit<Anthropic.MessageCreateParamsStreaming, 'stream'>;

/** One streamed model call. In the app this is the LLM proxy's streamModel. */
export type ModelGateway = (
  params: MessageStreamParams,
  opts: { signal?: AbortSignal; onEvent?: (e: Anthropic.RawMessageStreamEvent) => void },
) => Promise<Anthropic.Message>;

export type Effort = 'low' | 'medium' | 'high';

export interface ToolActivity {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
}

export interface TurnUpdate {
  /** Completed API turns so far (assistant and tool-result user turns). */
  turns: Anthropic.MessageParam[];
  /** The assistant turn currently streaming, if any. */
  partial: Anthropic.ContentBlockParam[] | null;
  activity: ToolActivity[];
}

interface ModelOptions {
  gateway: ModelGateway;
  model: string;
  prefix: Prefix;
  signal?: AbortSignal;
  maxTokens?: number;
  effort?: Effort;
  /** Whether ask_followup may end the turn. Default true. */
  allowQuestions?: boolean;
}

export interface RunStepOptions extends ModelOptions {
  /** The whole conversation so far: history, this turn's user message, earlier steps. */
  messages: Anthropic.MessageParam[];
  /** Which tools are valid (the prefix's runtime). Default `interactive`. */
  runtime?: AgentRuntime;
  /** The streaming assistant turn, on every block start and text delta. */
  onPartial?: (partial: Anthropic.ContentBlockParam[]) => void;
}

/** A tool call for the host, input checked against the contract. */
export interface HostCall {
  id: string;
  name: string;
  input: unknown;
}

export interface AgentStep {
  /** The assistant turn, exactly as returned (thinking blocks included). */
  assistant: Anthropic.MessageParam;
  stopReason: Anthropic.StopReason | null;
  /**
   * - `final`: no tool calls to answer; the turn ends here.
   * - `tools`: answer `calls` (on the host) and `resolved`, then run the next step.
   * - `pause`: the model paused (`pause_turn`); run the next step as is.
   */
  kind: 'final' | 'tools' | 'pause';
  /** Calls the host must run, in order. */
  calls: HostCall[];
  /** Results decided here (control tools, invalid calls), by tool_use id. */
  resolved: Record<string, Anthropic.ToolResultBlockParam>;
  /** ask_followup was called: the turn ends once `calls` have run, with its result pending. */
  questions: { toolUseId: string; set: QuestionSet } | null;
  jobSuggestion: JobSuggestion | null;
}

export interface RunTurnOptions extends ModelOptions {
  /** Earlier conversation turns (complete messages only). */
  history: Anthropic.MessageParam[];
  /** This turn's user message (document context + request). */
  userTurn: Anthropic.MessageParam;
  host: ToolHost;
  maxIterations?: number;
  onUpdate?: (u: TurnUpdate) => void;
}

/**
 * A question set the turn ended on. The last assistant turn holds the ask_followup tool_use;
 * its tool_result is sent when the user answers, together with `results` (the tool results of
 * any other tool calls in that same assistant turn, which must share the user message).
 */
export interface PendingQuestions {
  toolUseId: string;
  set: QuestionSet;
  results: Anthropic.ToolResultBlockParam[];
}

export interface TurnResult {
  turns: Anthropic.MessageParam[];
  touched: string[];
  jobSuggestion: JobSuggestion | null;
  /** Set when the turn ended by asking the user questions. */
  questions: PendingQuestions | null;
  stopReason: Anthropic.StopReason | 'max_iterations' | null;
  iterations: number;
}

export class AgentTurnError extends Error {
  override name = 'AgentTurnError';
}

/** Mirror stream events into displayable partial content. */
function applyEvent(blocks: Anthropic.ContentBlockParam[], e: Anthropic.RawMessageStreamEvent) {
  if (e.type === 'content_block_start') {
    const b = e.content_block;
    if (b.type === 'text') blocks[e.index] = { type: 'text', text: b.text };
    else if (b.type === 'tool_use')
      blocks[e.index] = { type: 'tool_use', id: b.id, name: b.name, input: {} };
    else if (b.type === 'thinking')
      blocks[e.index] = { type: 'thinking', thinking: '', signature: '' };
  } else if (e.type === 'content_block_delta') {
    const b = blocks[e.index];
    if (b?.type === 'text' && e.delta.type === 'text_delta') b.text += e.delta.text;
  }
}

/** Response blocks can be sent back as-is; the SDK's param types are a superset in practice. */
const asParams = (content: Anthropic.ContentBlock[]) =>
  content as unknown as Anthropic.ContentBlockParam[];

const errorResult = (id: string, content: string): Anthropic.ToolResultBlockParam => ({
  type: 'tool_result',
  tool_use_id: id,
  is_error: true,
  content,
});

/** A host's result as a tool_result block. */
export function toolResultBlock(id: string, r: ToolResult): Anthropic.ToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: id,
    content: r.content,
    is_error: r.isError || undefined,
  };
}

/** One model call, with control tools and invalid calls answered here. */
export async function runAgentStep(o: RunStepOptions): Promise<AgentStep> {
  const partial: Anthropic.ContentBlockParam[] = [];
  const message = await o.gateway(
    {
      model: o.model,
      max_tokens: o.maxTokens ?? 16_000,
      system: o.prefix.system,
      tools: o.prefix.tools,
      messages: o.messages,
      // Automatic breakpoint on the conversation; the prefix carries its own 1h marker.
      cache_control: { type: 'ephemeral' },
      thinking: { type: 'adaptive' },
      output_config: { effort: o.effort ?? 'medium' },
    },
    {
      signal: o.signal,
      onEvent: (e) => {
        applyEvent(partial, e);
        if (e.type === 'content_block_delta' || e.type === 'content_block_start')
          o.onPartial?.([...partial]);
      },
    },
  );
  const step: AgentStep = {
    assistant: { role: 'assistant', content: asParams(message.content) },
    stopReason: message.stop_reason,
    kind: 'final',
    calls: [],
    resolved: {},
    questions: null,
    jobSuggestion: null,
  };
  const toolUses = message.content.filter(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (message.stop_reason === 'refusal') return step;
  if (message.stop_reason === 'pause_turn') return { ...step, kind: 'pause' };
  if (!toolUses.length || message.stop_reason !== 'tool_use') {
    if (message.stop_reason === 'max_tokens' && toolUses.length)
      throw new AgentTurnError('The response was cut off mid tool call (max_tokens)');
    return step;
  }

  step.kind = 'tools';
  for (const tu of toolUses) {
    if (tu.name === ASK_FOLLOWUP_TOOL) {
      const parsed = askFollowupInput.safeParse(tu.input);
      const error =
        o.allowQuestions === false
          ? 'Questions are not available here. Use your judgement and make the change.'
          : step.questions
            ? 'Ask all your questions in one ask_followup call.'
            : !parsed.success
              ? `Invalid input: ${parsed.error.issues[0]?.path.join('.') || '(root)'} ${parsed.error.issues[0]?.message ?? 'invalid'}`.trim()
              : null;
      if (error || !parsed.success)
        step.resolved[tu.id] = errorResult(tu.id, error ?? 'Invalid input');
      // No result yet: the user's answers become it.
      else step.questions = { toolUseId: tu.id, set: parsed.data };
      continue;
    }
    if (tu.name === SUGGEST_JOB_TOOL) {
      const parsed = suggestJobInput.safeParse(tu.input);
      if (parsed.success) {
        step.jobSuggestion = parsed.data;
        step.resolved[tu.id] = {
          type: 'tool_result',
          tool_use_id: tu.id,
          content:
            'Shown to the user as an offer to start a background job. Do not make edits for this request now.',
        };
      } else
        step.resolved[tu.id] = errorResult(
          tu.id,
          `Invalid input: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
        );
      continue;
    }
    const checked = checkToolCall(o.runtime ?? 'interactive', tu.name, tu.input);
    if (!checked.ok) step.resolved[tu.id] = toolResultBlock(tu.id, checked.result);
    else step.calls.push({ id: tu.id, name: tu.name, input: tu.input });
  }
  return step;
}

/**
 * The step's tool results in tool_use order: `resolved` and the host's `results`. The pending
 * ask_followup call has none (the user's answers become it).
 */
export function stepResults(
  step: AgentStep,
  results: Record<string, Anthropic.ToolResultBlockParam>,
): Anthropic.ToolResultBlockParam[] {
  const content = step.assistant.content;
  const ids = (typeof content === 'string' ? [] : content)
    .filter((b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use')
    .map((b) => b.id)
    .filter((id) => id !== step.questions?.toolUseId);
  return ids.map(
    (id) => step.resolved[id] ?? results[id] ?? errorResult(id, 'This tool call did not run.'),
  );
}

export async function runAgentTurn(o: RunTurnOptions): Promise<TurnResult> {
  const maxIterations = o.maxIterations ?? 10;
  const turns: Anthropic.MessageParam[] = [];
  const touched = new Set<string>();
  const activity: ToolActivity[] = [];
  let jobSuggestion: JobSuggestion | null = null;
  let questions: PendingQuestions | null = null;
  let stopReason: TurnResult['stopReason'] = null;
  let iterations = 0;

  const update = (partial: Anthropic.ContentBlockParam[] | null) =>
    o.onUpdate?.({
      turns: [...turns],
      partial: partial ? [...partial] : null,
      activity: [...activity],
    });

  while (iterations < maxIterations) {
    iterations++;
    const step = await runAgentStep({
      ...o,
      runtime: o.host.runtime,
      messages: [...o.history, o.userTurn, ...turns],
      onPartial: update,
    });
    stopReason = step.stopReason;
    turns.push(step.assistant);
    if (step.kind === 'pause') continue;
    if (step.kind === 'final') break;
    jobSuggestion = step.jobSuggestion ?? jobSuggestion;

    for (const [id, r] of Object.entries(step.resolved)) {
      const name = step.calls.find((c) => c.id === id)?.name ?? toolName(step, id);
      activity.push({ id, name, status: r.is_error ? 'error' : 'done' });
    }
    if (step.questions)
      activity.push({ id: step.questions.toolUseId, name: ASK_FOLLOWUP_TOOL, status: 'done' });
    const results: Record<string, Anthropic.ToolResultBlockParam> = {};
    for (const call of step.calls) {
      const act: ToolActivity = { id: call.id, name: call.name, status: 'running' };
      activity.push(act);
      update(null);
      const r = await executeTool(o.host, call.name, call.input);
      act.status = r.isError ? 'error' : 'done';
      for (const id of r.touched) touched.add(id);
      results[call.id] = toolResultBlock(call.id, r);
    }
    const blocks = stepResults(step, results);
    if (step.questions) {
      // The turn ends on the question form; sibling results wait with it.
      questions = { ...step.questions, results: blocks };
      update(null);
      break;
    }
    turns.push({ role: 'user', content: blocks });
    update(null);
    if (o.signal?.aborted) break;
  }
  if (iterations >= maxIterations && turns.at(-1)?.role === 'user') stopReason = 'max_iterations';
  return {
    turns,
    touched: [...touched],
    jobSuggestion: questions ? null : jobSuggestion,
    questions,
    stopReason,
    iterations,
  };
}

function toolName(step: AgentStep, id: string): string {
  const content = step.assistant.content;
  if (typeof content === 'string') return '?';
  const b = content.find((x) => x.type === 'tool_use' && x.id === id);
  return b?.type === 'tool_use' ? b.name : '?';
}

/** Plain text of the assistant turns (for summaries and tests). */
export function turnText(turns: Anthropic.MessageParam[]): string {
  return turns
    .filter((t) => t.role === 'assistant')
    .flatMap((t): (string | Anthropic.ContentBlockParam)[] =>
      typeof t.content === 'string' ? [t.content] : t.content,
    )
    .map((b) => (typeof b === 'string' ? b : b.type === 'text' ? b.text : ''))
    .filter(Boolean)
    .join('\n');
}
