/**
 * Interactive agent: conversations, messages and the per-message SSE stream.
 *
 * Story 4.2 turns the agent back on for interactive turns: `sendMessage` stores the request
 * with its document context (Story 4.1, built in the browser) and `runTurn` drives the loop in
 * `agent/turn.ts`, whose tools run in the user's editor tab. Answering follow-up questions
 * (Story 4.4) still throws AgentUnavailableError (503), and so do jobs (Story 4.5).
 */
import { assertCan } from '@greenfield/authz';
import {
  answerQuestionsInput,
  encodeSse,
  ModelNotAllowedError,
  resolveModel,
  SSE_KEEPALIVE,
  type Anthropic,
  type JobSuggestion,
  type PendingQuestions,
  type QuestionAnswers,
  type QuestionSet,
  type ToolActivity,
} from '@greenfield/agent';
import {
  agentConversations,
  agentMessages,
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type AgentMessageRow,
  type Db,
} from '@greenfield/db';
import { z } from 'zod';
import { getProject } from './projects';
import { getModelSettings } from './agent/model-settings';
import { settleStaleMessages } from './agent/stale';
import {
  advanceTurn,
  historyBefore,
  markSeen,
  type LoadTurnInputs,
  type RunContent,
  type TurnDeps,
} from './agent/turn';
import { AgentUnavailableError, NotFoundError, ValidationError, type Actor } from './types';

// ---------------------------------------------------------------------------------------------
// Stored shapes (agent_messages.content)
// ---------------------------------------------------------------------------------------------

export interface TurnContextRef {
  selection?: string[];
  frameId?: string | null;
  scopeNodeId?: string;
  /** Layer ids the turn may change (the selection it was sent with); null = whole page. */
  scope?: number[] | null;
}

/** User message: what they typed, and the exact API turn sent (context + prompt). */
export interface StoredUserContent {
  v: 1;
  prompt: string;
  context: TurnContextRef;
  turns: Anthropic.MessageParam[];
  /** Set when this message answers the questions asked by that assistant message. */
  answersFor?: string;
}

/** Assistant message: API turns (text, tool use, tool results), plus UI state while streaming. */
export interface StoredAssistantContent {
  v: 1;
  turns: Anthropic.MessageParam[];
  partial?: Anthropic.ContentBlockParam[] | null;
  activity?: ToolActivity[];
  touched?: string[];
  jobSuggestion?: JobSuggestion | null;
  stopReason?: string | null;
  /** The turn ended on ask_followup; the tool_result is pending until `answers` is set. */
  questions?: PendingQuestions | null;
  answers?: QuestionAnswers | null;
  /** The job this reply started on its own (a new design after answered questions). */
  startedJob?: { jobId: string; messageId: string } | null;
  /** Story 4.2: the turn in progress (tool calls out to the tab). Dropped when it ends. */
  run?: RunContent['run'];
}

/** A tool call the tab should run (or is running) for a streaming reply. */
export interface ToolCallView {
  id: string;
  name: string;
  input: unknown;
  state: 'queued' | 'claimed' | 'done';
}

export type Attachment =
  | { type: 'image'; url: string }
  | { type: 'url'; url: string }
  | { type: 'figma'; fileKey: string; nodeId: string };

export const attachmentSchema: z.ZodType<Attachment> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('image'), url: z.url({ protocol: /^https$/ }).max(2048) }).strict(),
  z.object({ type: z.literal('url'), url: z.url({ protocol: /^https?$/ }).max(2048) }).strict(),
  z
    .object({ type: z.literal('figma'), fileKey: z.string().max(64), nodeId: z.string().max(64) })
    .strict(),
]);

export interface MessageView {
  id: string;
  conversationId: string;
  seq: number;
  role: 'user' | 'assistant' | 'system';
  status: AgentMessageRow['status'];
  model: string | null;
  /** User prompt, or the assistant's text so far. */
  text: string;
  activity: ToolActivity[];
  touched: string[];
  jobSuggestion: JobSuggestion | null;
  /** Follow-up questions this reply asked, and what the user did with them. */
  questions: QuestionSet | null;
  answers: QuestionAnswers | null;
  /** User messages: the assistant message whose questions this message answers. */
  answersFor: string | null;
  /** The job message this reply started automatically (the client follows it). */
  startedJobMessageId: string | null;
  /** User messages: the selection/frame the prompt was sent with (retry reuses it). */
  context: TurnContextRef | null;
  /** Streaming replies: the calls of the current step, and the scope the tab enforces. */
  toolCalls: ToolCallView[];
  scope: number[] | null;
  jobId: string | null;
  attachments: Attachment[];
  error: string | null;
  createdAt: string;
}

const TERMINAL = new Set<AgentMessageRow['status']>(['complete', 'error', 'cancelled']);

function blocksText(blocks: (string | Anthropic.ContentBlockParam)[]): string[] {
  return blocks.map((b) => (typeof b === 'string' ? b : b.type === 'text' ? b.text : ''));
}

export function toMessageView(row: AgentMessageRow): MessageView {
  const base = {
    id: row.id,
    conversationId: row.conversationId,
    seq: row.seq,
    role: row.role,
    status: row.status,
    model: row.model,
    jobId: row.jobId,
    attachments: (row.attachments ?? []) as Attachment[],
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
  if (row.role === 'user') {
    const c = row.content as StoredUserContent;
    return {
      ...base,
      text: c.prompt ?? '',
      activity: [],
      touched: [],
      jobSuggestion: null,
      questions: null,
      answers: null,
      answersFor: c.answersFor ?? null,
      startedJobMessageId: null,
      context: c.context ?? null,
      toolCalls: [],
      scope: null,
    };
  }
  const c = (row.content ?? { v: 1, turns: [] }) as StoredAssistantContent;
  const run = row.status === 'streaming' ? c.run : null;
  const calls = run?.phase === 'tools' || run?.phase === 'ready' ? (run.pending?.calls ?? []) : [];
  const texts = (c.turns ?? [])
    .filter((t) => t.role === 'assistant')
    .flatMap((t) => blocksText(typeof t.content === 'string' ? [t.content] : t.content));
  if (c.partial) texts.push(...blocksText(c.partial));
  return {
    ...base,
    text: texts.filter(Boolean).join('\n\n'),
    activity: calls.length
      ? calls.map((x) => ({
          id: x.id,
          name: x.name,
          status: x.state !== 'done' ? 'running' : x.result?.is_error ? 'error' : 'done',
        }))
      : (c.activity ?? []),
    touched: c.touched ?? [],
    jobSuggestion: c.startedJob ? null : (c.jobSuggestion ?? null),
    questions: c.questions?.set ?? null,
    answers: c.answers ?? null,
    answersFor: null,
    startedJobMessageId: c.startedJob?.messageId ?? null,
    context: null,
    toolCalls: calls.map(({ id, name, input, state }) => ({ id, name, input, state })),
    scope: run?.scope ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Conversations and messages
// ---------------------------------------------------------------------------------------------

async function loadConversation(db: Db, actor: Actor, conversationId: string) {
  if (!z.uuid().safeParse(conversationId).success)
    throw new NotFoundError('Conversation not found');
  const [conv] = await db
    .select()
    .from(agentConversations)
    .where(
      and(
        eq(agentConversations.id, conversationId),
        eq(agentConversations.workspaceId, actor.workspace.id),
      ),
    )
    .limit(1);
  if (!conv) throw new NotFoundError('Conversation not found');
  return conv;
}

export async function loadMessage(db: Db, actor: Actor, messageId: string) {
  if (!z.uuid().safeParse(messageId).success) throw new NotFoundError('Message not found');
  const [row] = await db
    .select()
    .from(agentMessages)
    .where(and(eq(agentMessages.id, messageId), eq(agentMessages.workspaceId, actor.workspace.id)))
    .limit(1);
  if (!row) throw new NotFoundError('Message not found');
  return row;
}

/** The project's main chat (unscoped), with its messages. */
export async function getProjectChat(
  db: Db,
  actor: Actor,
  projectId: string,
): Promise<{ conversationId: string | null; messages: MessageView[] }> {
  assertCan(actor.role, 'project:read');
  await getProject(db, actor, projectId);
  const [conv] = await db
    .select()
    .from(agentConversations)
    .where(
      and(
        eq(agentConversations.projectId, projectId),
        eq(agentConversations.workspaceId, actor.workspace.id),
        isNull(agentConversations.commentThreadId),
        sql`${agentConversations.scope} is null`,
      ),
    )
    .orderBy(desc(agentConversations.updatedAt))
    .limit(1);
  if (!conv) return { conversationId: null, messages: [] };
  await settleStaleMessages(db, { conversationId: conv.id });
  return { conversationId: conv.id, messages: await listMessages(db, actor, conv.id) };
}

export async function listMessages(
  db: Db,
  actor: Actor,
  conversationId: string,
): Promise<MessageView[]> {
  assertCan(actor.role, 'project:read');
  await loadConversation(db, actor, conversationId);
  const rows = await db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.conversationId, conversationId))
    .orderBy(asc(agentMessages.seq));
  return rows.map(toMessageView);
}

/** Upper bound on the context a turn may carry (~20k tokens). */
export const MAX_CONTEXT_CHARS = 60_000;

export const sendMessageInput = z
  .object({
    projectId: z.uuid(),
    conversationId: z.uuid().optional(),
    prompt: z.string().trim().min(1).max(8000),
    model: z.string().max(100).optional(),
    selection: z.array(z.string().max(64)).max(50).optional(),
    frameId: z.string().max(64).nullish(),
    attachments: z.array(attachmentSchema).max(10).optional(),
    /** The `<document>` block from `buildTurnContext` (Story 4.1), built next to the editor. */
    context: z
      .string()
      .max(MAX_CONTEXT_CHARS)
      .refine((s) => s.startsWith('<document>') && s.endsWith('</document>'), {
        message: 'context must be a <document> block',
      })
      .optional(),
    /** The layers the turn may change (the selection); omitted = the whole page. */
    scope: z.array(z.number().int().nonnegative()).max(50).nullish(),
  })
  .strict();
export type SendMessageInput = z.infer<typeof sendMessageInput>;

export interface SentMessage {
  conversationId: string;
  userMessageId: string;
  messageId: string;
  /** False when the reply was produced without a model call (job offer). */
  needsRun: boolean;
}

function userTurnFor(prompt: string, context: string | undefined, attachments: Attachment[]) {
  const content: Anthropic.ContentBlockParam[] = [];
  if (context) content.push({ type: 'text', text: context });
  for (const a of attachments) {
    if (a.type === 'image') content.push({ type: 'image', source: { type: 'url', url: a.url } });
    else if (a.type === 'url')
      content.push({ type: 'text', text: `Attached web page (reference): ${a.url}` });
    else
      content.push({
        type: 'text',
        text: `Attached Figma frame: file ${a.fileKey}, node ${a.nodeId}`,
      });
  }
  content.push({ type: 'text', text: prompt });
  return { role: 'user', content } satisfies Anthropic.MessageParam;
}

/**
 * Send a chat message: the user message (with its document context) and a pending reply in one
 * transaction. The caller runs the reply with `runTurn` after the response; its tool calls go
 * to the sender's editor tab (Story 4.2).
 */
export async function sendMessage(db: Db, actor: Actor, raw: unknown): Promise<SentMessage> {
  assertCan(actor.role, 'agent:run');
  const parsed = sendMessageInput.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid message');
  const input = parsed.data;
  const project = await getProject(db, actor, input.projectId);
  if (project.archivedAt) throw new ValidationError('This project is archived');

  let model: string;
  try {
    model = resolveModel(
      await getModelSettings(db, actor.workspace.id),
      'interactive',
      input.model,
    );
  } catch (e) {
    if (e instanceof ModelNotAllowedError) throw new ValidationError(e.message);
    throw e;
  }
  const attachments = input.attachments ?? [];
  const userContent: StoredUserContent = {
    v: 1,
    prompt: input.prompt,
    context: {
      selection: input.selection,
      frameId: input.frameId ?? null,
      scope: input.scope?.length ? input.scope : null,
    },
    turns: [userTurnFor(input.prompt, input.context, attachments)],
  };

  return db.transaction(async (tx) => {
    let conversationId = input.conversationId;
    if (conversationId) {
      const [conv] = await tx
        .select()
        .from(agentConversations)
        .where(
          and(
            eq(agentConversations.id, conversationId),
            eq(agentConversations.workspaceId, actor.workspace.id),
            eq(agentConversations.projectId, input.projectId),
          ),
        )
        .for('update')
        .limit(1);
      if (!conv) throw new NotFoundError('Conversation not found');
    } else {
      const [conv] = await tx
        .insert(agentConversations)
        .values({
          workspaceId: actor.workspace.id,
          projectId: input.projectId,
          title: input.prompt.slice(0, 80),
          createdBy: actor.userId,
        })
        .returning();
      conversationId = conv!.id;
    }
    const [{ max }] = (await tx
      .select({ max: sql<number>`coalesce(max(${agentMessages.seq}), 0)::int` })
      .from(agentMessages)
      .where(eq(agentMessages.conversationId, conversationId))) as [{ max: number }];
    const [user] = await tx
      .insert(agentMessages)
      .values({
        conversationId,
        workspaceId: actor.workspace.id,
        seq: max + 1,
        role: 'user',
        content: userContent,
        attachments,
        status: 'complete',
        createdBy: actor.userId,
      })
      .returning();
    const [assistant] = await tx
      .insert(agentMessages)
      .values({
        conversationId,
        workspaceId: actor.workspace.id,
        seq: max + 2,
        role: 'assistant',
        content: { v: 1, turns: [] } satisfies StoredAssistantContent,
        status: 'pending',
        model,
        createdBy: actor.userId,
      })
      .returning();
    await tx
      .update(agentConversations)
      .set({ updatedAt: new Date() })
      .where(eq(agentConversations.id, conversationId));
    return {
      conversationId,
      userMessageId: user!.id,
      messageId: assistant!.id,
      needsRun: true,
    };
  });
}

/** What `advanceTurn` needs from a reply: its model, the history and the user turn. */
function turnInputs(db: Db, actor: Actor): LoadTurnInputs {
  return async (row) => {
    const conv = await loadConversation(db, actor, row.conversationId);
    const [userRow] = await db
      .select()
      .from(agentMessages)
      .where(and(eq(agentMessages.conversationId, conv.id), eq(agentMessages.seq, row.seq - 1)));
    if (!userRow || userRow.role !== 'user') throw new ValidationError('Missing user message');
    const stored = userRow.content as StoredUserContent;
    const history = await historyBefore(db, conv.id, userRow.seq);
    return {
      model:
        row.model ?? resolveModel(await getModelSettings(db, actor.workspace.id), 'interactive'),
      projectId: conv.projectId,
      conversationId: conv.id,
      scope: stored.context?.scope ?? null,
      messages: [...history, ...stored.turns],
    };
  };
}

/**
 * Run a reply's next model step(s) (Story 4.2): after `sendMessage`, and after the tab posts
 * the last tool result of a step. Never throws; a no-op when no step is due.
 */
export async function runTurn(
  db: Db,
  actor: Actor,
  messageId: string,
  deps: TurnDeps = {},
): Promise<MessageView> {
  await advanceTurn(db, actor, messageId, turnInputs(db, actor), deps);
  return toMessageView(await loadMessage(db, actor, messageId));
}

/** Answer an assistant message's follow-up questions. Not available until Story 4.4. */
export async function answerQuestions(
  db: Db,
  actor: Actor,
  messageId: string,
  raw: unknown,
): Promise<SentMessage> {
  assertCan(actor.role, 'agent:run');
  const parsed = answerQuestionsInput.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid answers');
  await loadMessage(db, actor, messageId);
  throw new AgentUnavailableError();
}

export async function cancelMessage(db: Db, actor: Actor, messageId: string): Promise<MessageView> {
  assertCan(actor.role, 'agent:run');
  await loadMessage(db, actor, messageId);
  await db
    .update(agentMessages)
    .set({ status: 'cancelled' })
    .where(
      and(eq(agentMessages.id, messageId), inArray(agentMessages.status, ['pending', 'streaming'])),
    );
  return toMessageView(await loadMessage(db, actor, messageId));
}

export async function getMessageView(
  db: Db,
  actor: Actor,
  messageId: string,
): Promise<MessageView> {
  assertCan(actor.role, 'project:read');
  return toMessageView(await loadMessage(db, actor, messageId));
}

export const messageStreamUrl = (messageId: string) => `/api/agent/messages/${messageId}/stream`;

/**
 * SSE frames for one message: a `message` event whenever its state changes, then `done` when it
 * reaches a terminal status. Ends after `maxMs` so serverless functions recycle; EventSource
 * reconnects and gets the current state immediately.
 */
export async function* messageEvents(
  db: Db,
  actor: Actor,
  messageId: string,
  opts: { signal?: AbortSignal; pollMs?: number; maxMs?: number; keepaliveMs?: number } = {},
): AsyncGenerator<string> {
  assertCan(actor.role, 'project:read');
  await loadMessage(db, actor, messageId);
  const pollMs = opts.pollMs ?? 300;
  const deadline = Date.now() + (opts.maxMs ?? 240_000);
  const keepaliveMs = opts.keepaliveMs ?? 15_000;
  let last = '';
  let lastSent = Date.now();
  let n = 0;
  yield encodeSse({ retry: 1000, data: { messageId }, event: 'open' });
  while (!opts.signal?.aborted) {
    let row = await loadMessage(db, actor, messageId);
    if (!TERMINAL.has(row.status) && (await settleStaleMessages(db, { messageId })))
      row = await loadMessage(db, actor, messageId);
    // The sender's open stream keeps a turn that waits on its tab alive (Story 4.2).
    if (!TERMINAL.has(row.status)) await markSeen(db, actor, row);
    const view = toMessageView(row);
    const json = JSON.stringify(view);
    if (json !== last) {
      last = json;
      lastSent = Date.now();
      yield encodeSse({ event: 'message', id: ++n, data: view });
    }
    if (TERMINAL.has(view.status)) {
      yield encodeSse({ event: 'done', data: { status: view.status } });
      return;
    }
    if (Date.now() > deadline) return;
    if (Date.now() - lastSent > keepaliveMs) {
      lastSent = Date.now();
      yield SSE_KEEPALIVE;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
