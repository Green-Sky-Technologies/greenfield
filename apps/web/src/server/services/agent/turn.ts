/**
 * Interactive turns with browser-run tools (Story 4.2).
 *
 * The server runs the Messages API loop one step at a time; the document lives in the user's
 * editor tab, so tools run there:
 *
 *   advanceTurn   model call (streamed, metered) → tool calls stored as `queued` (phase `tools`)
 *   SSE           the tab sees the calls in the message view (and keeps `seenAt` fresh)
 *   claimToolCall the tab claims a call (idempotency key = message id + tool_use id): only one
 *                 claim ever succeeds, so a call never runs twice, across reconnects and tabs
 *   submitToolResult  the result comes back; once every call has one, phase `ready`, and the
 *                 route runs `advanceTurn` again
 *
 * Nothing waits in a function while the browser works, so a hidden tab (the bridge fails fast
 * with `EditorHiddenError`; the tab keeps its claim and retries when shown) just pauses the
 * turn. A closed tab stops refreshing `seenAt`: after `TOOL_LEASE_MS` the turn is cancelled
 * (`settleStaleMessages`), and the tab also sends a cancel beacon on `pagehide`. Every write
 * is conditional on the message still streaming, so a cancel always wins.
 */
import { assertCan } from '@greenfield/authz';
import {
  AgentTurnError,
  buildPrefix,
  prefixCacheTtl,
  runAgentStep,
  stepResults,
  type AgentStep,
  type Anthropic,
} from '@greenfield/agent';
import { layerChange, mergeLayerChanges, type LayerChange } from '@greenfield/contracts';
import { agentMessages, and, asc, eq, sql, type AgentMessageRow, type Db } from '@greenfield/db';
import { z } from 'zod';
import { CHECK_FIELDS, checkLayers, checkPrompt, type DesignCheck } from '../design-systems/check';
import type { TurnDesignSystem } from '../design-systems/follow';
import { ProviderError, streamModel, type LlmProxyDeps } from '../llm-proxy';
import { NotFoundError, ValidationError, type Actor } from '../types';

/** Model calls per turn. */
export const MAX_STEPS = 12;
/** A turn waiting on the browser is cancelled when its tab hasn't been seen for this long. */
export const TOOL_LEASE_MS = 45_000;
/** How often an open stream refreshes `seenAt`. */
export const SEEN_THROTTLE_MS = 5_000;
/** One `advanceTurn` stops starting model calls after this (route maxDuration is 300 s). */
const ADVANCE_DEADLINE_MS = 200_000;
/** Self-check rounds per turn (Story 4.3): render, look, fix at most this many times. */
export const MAX_SELF_CHECKS = 2;
/** Self-check renders are half size: enough to judge a frame, a quarter of the image tokens. */
export const SELF_CHECK_SCALE = 0.5;
/** Frames one self-check renders at most (the render tool's limit is 20 ids). */
const MAX_CHECK_FRAMES = 4;
/** Tool_use ids of self-check renders: never the model's (theirs start with `toolu_`). */
const SELF_CHECK_ID = 'selfcheck_';
export const SELF_CHECK_PROMPT =
  'Self-check: this is a render of the frame you just changed. Compare it with the request. ' +
  'If anything is off (a font that fell back to Regular, clipped or overlapping text, ragged card ' +
  "heights, changes the user didn't ask for), fix it with one run_batch. If it looks right, reply " +
  'with one short sentence and no tool calls.';
/** Design-system check rounds per turn (Story 10.5): check, fix, check again. */
export const MAX_DESIGN_CHECKS = 2;
/** Tool_use ids of the design-system check's reads. */
const DESIGN_CHECK_ID = 'dscheck_';
/** Fields of a changed layer that the design-system check looks at. */
const CHECKED_FIELDS: ReadonlySet<string> = new Set([
  'fills',
  'strokes',
  'layout',
  'boundVariables',
  'styles',
]);

export interface ToolCallState {
  id: string;
  name: string;
  input: unknown;
  state: 'queued' | 'claimed' | 'done';
  /** The tab that claimed it. */
  claimedBy?: string;
  result?: Anthropic.ToolResultBlockParam;
  touched?: number[];
  /** `run_batch`: what changed, from the tab (Story 4.7). */
  changes?: LayerChange[];
  /** `run_batch`: the top-level frames the changes are in. */
  frames?: number[];
}

/** An interactive turn in progress (`StoredAssistantContent.run`). */
export interface TurnRun {
  /** `model`: a model call is running; `tools`: waiting for the tab; `ready`: next call due. */
  phase: 'model' | 'tools' | 'ready';
  step: number;
  /** Layers the tab may change (the selection the request was sent with); null = whole page. */
  scope: number[] | null;
  /**
   * The calls out to the tab (phases `tools` and `ready`): a model step's, or (`step` null) the
   * self-check render the server asked for (Story 4.3).
   */
  pending: { step: AgentStep | null; calls: ToolCallState[] } | null;
  /** Frames changed since the last render, and self-checks done so far (Story 4.3). */
  check?: { frames: number[]; rounds: number };
  /** Story 10.5: design-system checks so far, and whether the turn changed layers since. */
  design?: { rounds: number; dirty: boolean };
  /** Last phase change (ISO). */
  at: string;
  /** Last sign of the requesting tab (ISO): its stream, a claim or a result. */
  seenAt: string;
}

/** The parts of the stored assistant content this module reads and writes. */
export interface RunContent {
  v: 1;
  turns: Anthropic.MessageParam[];
  partial?: Anthropic.ContentBlockParam[] | null;
  touched?: string[];
  jobSuggestion?: unknown;
  stopReason?: string | null;
  run?: TurnRun | null;
  /** What the turn changed, one record per layer (Story 4.7). */
  changes?: LayerChange[];
  /** The turn's undo steps (its run_batch labels), in the order they ran. */
  undoLabels?: string[];
  /** Story 10.5: the design-system check of what the turn changed. */
  designCheck?: DesignCheck;
  [k: string]: unknown;
}

export interface TurnDeps {
  proxy?: LlmProxyDeps;
  /** Min interval between progress writes while the model streams (ms). */
  flushMs?: number;
  /** How often to check for cancellation while the model streams (ms). */
  cancelPollMs?: number;
  /** Self-check rounds per turn (default MAX_SELF_CHECKS; 0 turns self-checks off). */
  maxSelfChecks?: number;
  now?: () => Date;
}

/** What the user turn and history need from the service that owns conversations. */
export interface TurnInputs {
  model: string;
  projectId: string;
  conversationId: string;
  scope: number[] | null;
  /** History plus this turn's user message, ready for the model. */
  messages: Anthropic.MessageParam[];
  /** The file's design system (Story 10.5): a prefix block and the post-turn check's rules. */
  designSystem?: TurnDesignSystem | null;
}

export type LoadTurnInputs = (row: AgentMessageRow) => Promise<TurnInputs>;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const iso = (d: Date) => d.toISOString();

async function lockMessage(tx: Tx, actor: Actor, messageId: string) {
  if (!z.uuid().safeParse(messageId).success) throw new NotFoundError('Message not found');
  const [row] = await tx
    .select()
    .from(agentMessages)
    .where(and(eq(agentMessages.id, messageId), eq(agentMessages.workspaceId, actor.workspace.id)))
    .for('update')
    .limit(1);
  if (!row || row.role !== 'assistant') throw new NotFoundError('Message not found');
  return row;
}

function userFacingError(e: unknown): string {
  if (e instanceof ProviderError) return e.message;
  if (e instanceof ValidationError || e instanceof NotFoundError) return e.message;
  if (e instanceof AgentTurnError) return e.message;
  return 'Something went wrong running the agent.';
}

const RENDER_DROPPED = 'A render was shown here during the turn; it is not kept.';

const isImage = (b: unknown) =>
  typeof b === 'object' && b !== null && (b as { type?: string }).type === 'image';

/** The turns without their renders (Story 4.3 AC: renders are not stored beyond the turn). */
export function withoutRenders(turns: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const strip = <T>(blocks: T[]): T[] =>
    blocks.some(isImage)
      ? [
          ...blocks.filter((b) => !isImage(b)),
          { type: 'text', text: RENDER_DROPPED } as unknown as T,
        ]
      : blocks;
  return turns.map((t) => {
    if (t.role !== 'user' || typeof t.content === 'string') return t;
    return {
      ...t,
      content: strip(
        t.content.map((b) =>
          b.type === 'tool_result' && Array.isArray(b.content)
            ? { ...b, content: strip(b.content) }
            : b,
        ),
      ),
    };
  });
}

/** The content a finished turn keeps (no run state, no partial, no renders). */
function finished(c: RunContent, extra: Partial<RunContent> = {}): RunContent {
  const rest: RunContent = { ...c, ...extra };
  delete rest.run;
  delete rest.partial;
  return { ...rest, turns: withoutRenders(rest.turns ?? []), activity: [] };
}

/** Image blocks of a tool result (a render). */
function images(r: Anthropic.ToolResultBlockParam | undefined): Anthropic.ImageBlockParam[] {
  if (!r || r.is_error || !Array.isArray(r.content)) return [];
  return r.content.filter((b): b is Anthropic.ImageBlockParam => b.type === 'image');
}

/** Fold a step's results into the turn's change records, undo labels and self-check state. */
function recordStep(c: RunContent, calls: ToolCallState[]) {
  let changes = c.changes ?? [];
  const undoLabels = [...(c.undoLabels ?? [])];
  const check = { frames: [...(c.run?.check?.frames ?? [])], rounds: c.run?.check?.rounds ?? 0 };
  const design = { rounds: c.run?.design?.rounds ?? 0, dirty: c.run?.design?.dirty ?? false };
  for (const x of calls) {
    if (!x.result || x.result.is_error) continue;
    if (x.name === 'render') check.frames = [];
    if (x.name !== 'run_batch' || !x.touched?.length) continue;
    undoLabels.push(String((x.input as { label?: unknown }).label ?? ''));
    if (x.changes?.length) changes = mergeLayerChanges([changes, x.changes]);
    const frames = x.frames?.length ? x.frames : x.touched;
    check.frames = [...new Set([...check.frames, ...frames])];
    design.dirty = true;
  }
  return { changes, undoLabels, check, design };
}

/** The layers the design-system check looks at: added ones, and changed paints or layout. */
function checkedLayers(changes: LayerChange[]): Set<number> {
  return new Set(
    changes
      .filter(
        (x) =>
          x.kind === 'added' ||
          (x.kind === 'changed' && x.fields.some((f) => CHECKED_FIELDS.has(f.field))),
      )
      .map((x) => x.id),
  );
}

/** What `get_node` returned in the check's reads. */
function readNodes(calls: ToolCallState[]): unknown[] {
  return calls.flatMap((x) => {
    if (!x.result || x.result.is_error || !Array.isArray(x.result.content)) return [];
    return x.result.content.flatMap((b) => {
      if (b.type !== 'text') return [];
      try {
        const parsed = JSON.parse(b.text) as { node?: unknown };
        return [parsed.node ?? parsed];
      } catch {
        return [];
      }
    });
  });
}

/**
 * The server-side check due when the model ends a turn, if any: first the design-system check
 * (Story 10.5) of layers changed since the last one, then the self-check render (Story 4.3).
 * Both are calls out to the tab with no model step.
 */
function dueCheck(
  c: RunContent,
  run: TurnRun,
  designSystem: TurnDesignSystem | null | undefined,
  maxSelfChecks: number,
): (Pick<TurnRun, 'check' | 'design'> & { calls: ToolCallState[] }) | null {
  const design = run.design ?? { rounds: 0, dirty: false };
  const check = run.check ?? { frames: [], rounds: 0 };
  if (designSystem && design.dirty && design.rounds < MAX_DESIGN_CHECKS) {
    const only = checkedLayers(c.changes ?? []);
    const frames = [
      ...new Set(
        (c.changes ?? []).flatMap((x) => (only.has(x.id) && x.frame !== null ? [x.frame] : [])),
      ),
    ].slice(0, MAX_CHECK_FRAMES);
    if (frames.length) {
      const rounds = design.rounds + 1;
      return {
        check,
        design: { rounds, dirty: false },
        calls: frames.map((id, i) => ({
          id: `${DESIGN_CHECK_ID}${rounds}_${i}`,
          name: 'get_node',
          input: { id, depth: 8, fields: [...CHECK_FIELDS] },
          state: 'queued' as const,
        })),
      };
    }
  }
  if (check.frames.length && check.rounds < maxSelfChecks) {
    const rounds = check.rounds + 1;
    return {
      design,
      check: { frames: [], rounds },
      calls: [
        {
          id: `${SELF_CHECK_ID}${rounds}`,
          name: 'render',
          input: { ids: check.frames.slice(0, MAX_CHECK_FRAMES), scale: SELF_CHECK_SCALE },
          state: 'queued',
        },
      ],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Advancing a turn (server side)
// ---------------------------------------------------------------------------------------------

type Claim =
  { kind: 'none' } | { kind: 'run'; row: AgentMessageRow; content: RunContent; inputs: TurnInputs };

/**
 * Take the next step if one is due: a `pending` message starts, a `ready` one gets its tool
 * results appended. Ends the turn instead when the step limit is reached.
 */
async function claimStep(
  db: Db,
  actor: Actor,
  messageId: string,
  load: LoadTurnInputs,
  now: Date,
  maxSelfChecks: number,
): Promise<Claim> {
  return db.transaction(async (tx) => {
    const row = await lockMessage(tx, actor, messageId);
    const c = (row.content ?? { v: 1, turns: [] }) as RunContent;
    const turns = [...(c.turns ?? [])];
    const touched = new Set(c.touched ?? []);
    let step: number;
    let inputs: TurnInputs;
    if (row.status === 'pending') {
      step = 1;
      inputs = await load(row);
    } else if (
      row.status === 'streaming' &&
      c.run?.phase === 'ready' &&
      c.run.pending?.step === null &&
      c.run.pending.calls[0]?.id.startsWith(DESIGN_CHECK_ID)
    ) {
      // The design-system check's reads came back (Story 10.5): check them on the server.
      inputs = await load(row);
      const rules = inputs.designSystem?.rules;
      const rounds = c.run.design?.rounds ?? 1;
      const found = rules
        ? checkLayers(readNodes(c.run.pending.calls), rules, checkedLayers(c.changes ?? []))
        : [];
      if (rules)
        c.designCheck = {
          system: rules.name,
          rounds,
          found: c.designCheck?.found ?? found,
          left: found,
        };
      step = c.run.step + 1;
      if (!rules || !found.length || rounds >= MAX_DESIGN_CHECKS || step > MAX_STEPS) {
        // Nothing to fix (or no rounds left): go on to the self-check, or end the turn.
        const next = dueCheck(c, c.run, null, maxSelfChecks);
        await tx
          .update(agentMessages)
          .set(
            next
              ? {
                  content: {
                    ...c,
                    run: {
                      ...c.run,
                      phase: 'tools',
                      check: next.check,
                      design: next.design,
                      pending: { step: null, calls: next.calls },
                      at: iso(now),
                      seenAt: iso(now),
                    },
                  } satisfies RunContent,
                }
              : { status: 'complete', content: finished(c) },
          )
          .where(eq(agentMessages.id, row.id));
        return { kind: 'none' };
      }
      turns.push({ role: 'user', content: [{ type: 'text', text: checkPrompt(rules, found) }] });
    } else if (
      row.status === 'streaming' &&
      c.run?.phase === 'ready' &&
      c.run.pending?.step === null
    ) {
      // The self-check render came back: show it to the model (Story 4.3).
      const shown = images(c.run.pending.calls[0]?.result);
      if (!shown.length) {
        await tx
          .update(agentMessages)
          .set({ status: 'complete', content: finished(c) })
          .where(eq(agentMessages.id, row.id));
        return { kind: 'none' };
      }
      turns.push({ role: 'user', content: [{ type: 'text', text: SELF_CHECK_PROMPT }, ...shown] });
      step = c.run.step + 1;
      inputs = await load(row);
    } else if (row.status === 'streaming' && c.run?.phase === 'ready' && c.run.pending?.step) {
      const { pending } = c.run;
      const pendingStep = pending.step!;
      const results = Object.fromEntries(
        pending.calls.filter((x) => x.result).map((x) => [x.id, x.result!]),
      );
      for (const x of pending.calls) for (const id of x.touched ?? []) touched.add(String(id));
      const recorded = recordStep(c, pending.calls);
      c.changes = recorded.changes;
      c.undoLabels = recorded.undoLabels;
      c.run = { ...c.run, check: recorded.check, design: recorded.design };
      const blocks = stepResults(pendingStep, results);
      if (pendingStep.questions) {
        // ask_followup ends the turn (Story 4.4): its result is the user's answers, sent later.
        await tx
          .update(agentMessages)
          .set({
            status: 'complete',
            content: finished(c, {
              touched: [...touched],
              questions: { ...pendingStep.questions, results: blocks },
            }),
          })
          .where(eq(agentMessages.id, row.id));
        return { kind: 'none' };
      }
      turns.push({ role: 'user', content: blocks });
      step = c.run.step + 1;
      if (step > MAX_STEPS) {
        await tx
          .update(agentMessages)
          .set({
            status: 'complete',
            error: 'Stopped after too many steps.',
            content: finished(c, { turns, touched: [...touched], stopReason: 'max_iterations' }),
          })
          .where(eq(agentMessages.id, row.id));
        return { kind: 'none' };
      }
      inputs = await load(row);
    } else return { kind: 'none' };
    const content: RunContent = {
      ...c,
      v: 1,
      turns,
      touched: [...touched],
      partial: null,
      run: {
        phase: 'model',
        step,
        scope: inputs.scope,
        pending: null,
        check: c.run?.check ?? { frames: [], rounds: 0 },
        design: c.run?.design ?? { rounds: 0, dirty: false },
        at: iso(now),
        seenAt: c.run?.seenAt ?? iso(now),
      },
    };
    const [updated] = await tx
      .update(agentMessages)
      .set({ status: 'streaming', content })
      .where(eq(agentMessages.id, row.id))
      .returning();
    return { kind: 'run', row: updated!, content, inputs };
  });
}

/** Write `content` (and maybe a final status) unless the message stopped streaming. */
async function writeIfStreaming(
  db: Db,
  messageId: string,
  set: { content: RunContent; status?: 'complete' | 'error'; error?: string | null },
): Promise<boolean> {
  const r = await db
    .update(agentMessages)
    .set(set)
    .where(and(eq(agentMessages.id, messageId), eq(agentMessages.status, 'streaming')))
    .returning({ id: agentMessages.id });
  return r.length > 0;
}

/** One model call for a claimed step. Returns whether another step is due right away. */
async function runStep(
  db: Db,
  actor: Actor,
  claim: Extract<Claim, { kind: 'run' }>,
  deps: TurnDeps,
): Promise<boolean> {
  const { row, inputs } = claim;
  let content = claim.content;
  const run = content.run!;
  const now = () => deps.now?.() ?? new Date();
  const controller = new AbortController();
  const checkCancelled = async () => {
    const [r] = await db
      .select({ status: agentMessages.status })
      .from(agentMessages)
      .where(eq(agentMessages.id, row.id));
    if (r?.status !== 'streaming') controller.abort();
  };
  let partial: Anthropic.ContentBlockParam[] | null = null;
  let lastFlush = 0;
  let writing: Promise<unknown> = Promise.resolve();
  const flush = () => {
    const p = partial;
    lastFlush = Date.now();
    writing = writing.then(() =>
      writeIfStreaming(db, row.id, { content: { ...content, partial: p } }),
    );
  };
  const poll = setInterval(() => void checkCancelled().catch(() => {}), deps.cancelPollMs ?? 1000);
  try {
    const step = await runAgentStep({
      gateway: (params, o) =>
        streamModel(
          db,
          {
            workspaceId: actor.workspace.id,
            userId: actor.userId,
            projectId: inputs.projectId,
            conversationId: inputs.conversationId,
            messageId: row.id,
            task: 'interactive',
          },
          params,
          o,
          deps.proxy,
        ),
      model: inputs.model,
      prefix: buildPrefix('interactive', prefixCacheTtl(), inputs.designSystem?.prompt),
      messages: [...inputs.messages, ...content.turns],
      runtime: 'interactive',
      signal: controller.signal,
      effort: 'medium',
      onPartial: (p) => {
        partial = p;
        if (Date.now() - lastFlush >= (deps.flushMs ?? 250)) flush();
      },
    });
    await writing.catch(() => {});
    const turns = [...content.turns, step.assistant];
    const base: RunContent = {
      ...content,
      turns,
      partial: null,
      jobSuggestion: step.jobSuggestion ?? content.jobSuggestion ?? null,
      stopReason: step.stopReason,
    };
    const next =
      step.kind === 'final' && step.stopReason === 'end_turn' && run.step < MAX_STEPS
        ? dueCheck(base, run, inputs.designSystem, deps.maxSelfChecks ?? MAX_SELF_CHECKS)
        : null;
    if (next) {
      // The turn changed layers nobody checked since: the tab reads or renders them.
      content = {
        ...base,
        run: {
          ...run,
          phase: 'tools',
          check: next.check,
          design: next.design,
          pending: { step: null, calls: next.calls },
          at: iso(now()),
          seenAt: iso(now()),
        },
      };
      await writeIfStreaming(db, row.id, { content });
      return false;
    }
    if (step.kind === 'final') {
      await writeIfStreaming(db, row.id, {
        status: 'complete',
        content: finished(base),
        error: step.stopReason === 'refusal' ? 'The model declined this request.' : null,
      });
      return false;
    }
    const calls: ToolCallState[] = step.calls.map((x) => ({ ...x, state: 'queued' }));
    content = {
      ...base,
      run: {
        ...run,
        phase: calls.length ? 'tools' : 'ready',
        pending: { step, calls },
        at: iso(now()),
        // The tab gets a full lease to pick the calls up.
        seenAt: iso(now()),
      },
    };
    const wrote = await writeIfStreaming(db, row.id, { content });
    return wrote && !calls.length;
  } catch (e) {
    await writing.catch(() => {});
    const aborted = controller.signal.aborted;
    if (!aborted) console.error('[agent] step failed', e instanceof Error ? e.name : typeof e);
    const keep = { ...content, partial } as RunContent;
    if (aborted)
      // Cancelled: keep what streamed, under the cancel.
      await db
        .update(agentMessages)
        .set({ content: finished(keep, { partial }) })
        .where(eq(agentMessages.id, row.id));
    else
      await writeIfStreaming(db, row.id, {
        status: 'error',
        content: finished(keep, { partial }),
        error: userFacingError(e),
      });
    return false;
  } finally {
    clearInterval(poll);
  }
}

/**
 * Run the turn's next model step(s), if any are due, until it waits for the tab or ends. Safe
 * to call any number of times: only one caller claims a step. Never throws.
 */
export async function advanceTurn(
  db: Db,
  actor: Actor,
  messageId: string,
  load: LoadTurnInputs,
  deps: TurnDeps = {},
): Promise<void> {
  const started = Date.now();
  try {
    for (;;) {
      const claim = await claimStep(
        db,
        actor,
        messageId,
        load,
        deps.now?.() ?? new Date(),
        deps.maxSelfChecks ?? MAX_SELF_CHECKS,
      );
      if (claim.kind === 'none') return;
      const again = await runStep(db, actor, claim, deps);
      if (!again || Date.now() - started > ADVANCE_DEADLINE_MS) return;
    }
  } catch (e) {
    console.error('[agent] advance failed', e instanceof Error ? e.name : typeof e);
    await db
      .update(agentMessages)
      .set({ status: 'error', error: userFacingError(e) })
      .where(and(eq(agentMessages.id, messageId), eq(agentMessages.status, 'streaming')))
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------------------------
// The tab's side: claim a call, post its result, stay seen
// ---------------------------------------------------------------------------------------------

export const clientId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid client id');
export const toolUseId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

/** Tool-result content as `executeTool` in the browser produces it (text, PNG renders). */
export const toolResultContent = z
  .array(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('text'), text: z.string().max(200_000) }).strict(),
      z
        .object({
          type: z.literal('image'),
          source: z
            .object({
              type: z.literal('base64'),
              media_type: z.literal('image/png'),
              data: z
                .string()
                .max(6_000_000)
                .regex(/^[A-Za-z0-9+/]*={0,2}$/),
            })
            .strict(),
        })
        .strict(),
    ]),
  )
  .min(1)
  .max(4);

export const toolCallBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim'), clientId }).strict(),
  z
    .object({
      action: z.literal('result'),
      clientId,
      content: toolResultContent,
      isError: z.boolean(),
      touched: z.array(z.number().int().nonnegative()).max(10_000).default([]),
      changes: z.array(layerChange).max(2_000).optional(),
      frames: z.array(z.number().int().nonnegative()).max(200).optional(),
    })
    .strict(),
]);
export type ToolCallBody = z.input<typeof toolCallBody>;

export type ToolCallResponse =
  /** claim: run it. result: stored (or already stored: `duplicate`). */
  | { ok: true; duplicate?: boolean; ready?: boolean }
  /** Don't run it: claimed elsewhere, already done, or the turn ended. */
  | { ok: false; reason: 'claimed' | 'done' | 'not_running' | 'unknown_call' };

/**
 * Claim a tool call or post its result. Only the member who sent the request runs its tools.
 * `ready` means every call of the step has a result: run `advanceTurn` next.
 */
export async function toolCallAction(
  db: Db,
  actor: Actor,
  messageId: string,
  callId: string,
  raw: unknown,
  now: Date = new Date(),
): Promise<ToolCallResponse> {
  assertCan(actor.role, 'agent:run');
  const parsed = toolCallBody.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid tool call request');
  if (!toolUseId.safeParse(callId).success) throw new NotFoundError('Tool call not found');
  const body = parsed.data;
  return db.transaction(async (tx) => {
    const row = await lockMessage(tx, actor, messageId);
    if (row.createdBy !== actor.userId) throw new NotFoundError('Message not found');
    const c = row.content as RunContent;
    const call = c.run?.pending?.calls.find((x) => x.id === callId);
    if (!call)
      return {
        ok: false,
        reason: row.status === 'streaming' ? 'unknown_call' : 'not_running',
      } as const;
    if (row.status !== 'streaming' || c.run?.phase !== 'tools') {
      if (body.action === 'result' && call.state === 'done' && call.claimedBy === body.clientId)
        return { ok: true, duplicate: true } as const;
      return { ok: false, reason: 'not_running' } as const;
    }
    const save = (calls: ToolCallState[], phase: TurnRun['phase']) =>
      tx
        .update(agentMessages)
        .set({
          content: {
            ...c,
            run: {
              ...c.run!,
              phase,
              pending: { ...c.run!.pending!, calls },
              seenAt: iso(now),
              ...(phase !== c.run!.phase ? { at: iso(now) } : {}),
            },
          } satisfies RunContent,
        })
        .where(eq(agentMessages.id, row.id));
    const calls = c.run.pending!.calls;
    if (body.action === 'claim') {
      if (call.state === 'done') return { ok: false, reason: 'done' } as const;
      if (call.state === 'claimed' && call.claimedBy !== body.clientId)
        return { ok: false, reason: 'claimed' } as const;
      await save(
        calls.map((x) =>
          x.id === callId ? { ...x, state: 'claimed', claimedBy: body.clientId } : x,
        ),
        'tools',
      );
      return { ok: true } as const;
    }
    if (call.claimedBy !== body.clientId) return { ok: false, reason: 'claimed' } as const;
    if (call.state === 'done') return { ok: true, duplicate: true } as const;
    const result: Anthropic.ToolResultBlockParam = {
      type: 'tool_result',
      tool_use_id: call.id,
      content: body.content,
      ...(body.isError ? { is_error: true } : {}),
    };
    const next = calls.map((x) =>
      x.id === callId
        ? {
            ...x,
            state: 'done' as const,
            result,
            touched: body.touched,
            ...(body.changes ? { changes: body.changes } : {}),
            ...(body.frames ? { frames: body.frames } : {}),
          }
        : x,
    );
    const ready = next.every((x) => x.state === 'done');
    await save(next, ready ? 'ready' : 'tools');
    return { ok: true, ready } as const;
  });
}

/** The requesting tab's stream is open: keep its lease (throttled; one small write). */
export async function markSeen(db: Db, actor: Actor, row: AgentMessageRow, now = new Date()) {
  const run = (row.content as RunContent | null)?.run;
  if (row.status !== 'streaming' || !run || row.createdBy !== actor.userId) return;
  if (now.getTime() - Date.parse(run.seenAt) < SEEN_THROTTLE_MS) return;
  await db
    .update(agentMessages)
    .set({
      content: sql`jsonb_set(${agentMessages.content}, '{run,seenAt}', to_jsonb(${iso(now)}::text))`,
    })
    .where(
      and(
        eq(agentMessages.id, row.id),
        eq(agentMessages.status, 'streaming'),
        sql`${agentMessages.content} ? 'run'`,
      ),
    );
}

// ---------------------------------------------------------------------------------------------
// History (earlier exchanges of the conversation)
// ---------------------------------------------------------------------------------------------

/** Upper bound on replayed history (JSON characters, ~4 chars/token). */
export const MAX_HISTORY_CHARS = 200_000;

const isDocBlock = (b: unknown) =>
  typeof b === 'object' &&
  b !== null &&
  (b as { type?: string }).type === 'text' &&
  ((b as { text?: string }).text ?? '').startsWith('<document>');

/** History never replays an earlier turn's document context: only the newest turn has one. */
export function withoutDocument(turn: Anthropic.MessageParam): Anthropic.MessageParam {
  if (typeof turn.content === 'string') return turn;
  return { ...turn, content: turn.content.filter((b) => !isDocBlock(b)) } as Anthropic.MessageParam;
}

/**
 * Keep the most recent exchanges within MAX_HISTORY_CHARS. The cut only moves when the window
 * overflows, and then jumps to half the budget, so between jumps the history prefix stays the
 * same from request to request (prompt-cache friendly).
 */
export function windowHistory(
  exchanges: Anthropic.MessageParam[][],
  maxChars = MAX_HISTORY_CHARS,
): Anthropic.MessageParam[] {
  const sizes = exchanges.map((e) => JSON.stringify(e).length);
  let cut = 0;
  let acc = 0;
  for (let i = 0; i < sizes.length; i++) {
    acc += sizes[i]!;
    if (acc > maxChars) while (acc > maxChars / 2 && cut < i) acc -= sizes[cut++]!;
  }
  return exchanges.slice(cut).flat();
}

/** The ask_followup call a user turn answers: the id of its last leading tool_result. */
function answeredToolUseId(turn: Anthropic.MessageParam | undefined): string | null {
  if (!turn || typeof turn.content === 'string') return null;
  let id: string | null = null;
  for (const b of turn.content) {
    if (b.type !== 'tool_result') break;
    id = b.tool_use_id;
  }
  return id;
}

/**
 * Earlier complete exchanges of a conversation. Failed and cancelled replies are skipped. An
 * answer to follow-up questions (Story 4.4) joins the exchange that asked, right after the
 * ask_followup call, so a window cut never separates a tool_result from its call.
 */
export async function historyBefore(
  db: Db,
  conversationId: string,
  seq: number,
): Promise<Anthropic.MessageParam[]> {
  const rows = await db
    .select()
    .from(agentMessages)
    .where(
      and(eq(agentMessages.conversationId, conversationId), sql`${agentMessages.seq} < ${seq}`),
    )
    .orderBy(asc(agentMessages.seq));
  const exchanges: Anthropic.MessageParam[][] = [];
  let open: Anthropic.MessageParam[] | null = null;
  // The exchange whose reply ended on unanswered questions, by ask_followup tool_use id.
  let asked: { toolUseId: string } | null = null;
  for (const r of rows) {
    if (r.role === 'user') {
      const turns = ((r.content as { turns?: Anthropic.MessageParam[] }).turns ?? []).map(
        withoutDocument,
      );
      // Answers reopen the asking exchange (always the newest); their reply continues it.
      open =
        asked && answeredToolUseId(turns[0]) === asked.toolUseId
          ? [...exchanges.pop()!, ...turns]
          : turns;
      asked = null;
    } else if (r.role === 'assistant' && open) {
      // An exchange counts only with a complete reply (a user turn alone would break alternation).
      if (r.status === 'complete') {
        const c = r.content as RunContent & { questions?: { toolUseId: string } | null };
        exchanges.push([...open, ...(c.turns ?? [])]);
        if (c.questions) asked = { toolUseId: c.questions.toolUseId };
      }
      open = null;
    }
  }
  return windowHistory(exchanges);
}
