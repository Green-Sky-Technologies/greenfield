/**
 * Interactive agent (Stories 5.4, 5.6 of CrunchDesign): conversations, messages and the
 * per-message SSE stream.
 *
 * Running turns is switched off until Epic 4: the tools edited the HTML model's DesignDoc,
 * which Story 1.2 removed. `sendMessage` and `answerQuestions` throw AgentUnavailableError
 * (routes answer 503). The loop itself (`runAgentTurn`), the prompt prefix, metering and SSE
 * stay in `@greenfield/agent`; Epic 4 wires them to the FigCraft tools run through the bridge.
 * Reading, streaming and cancelling stored messages still work.
 */
import { assertCan } from '@greenfield/authz';
import {
  answerQuestionsInput,
  encodeSse,
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
import { settleStaleMessages } from './agent/stale';
import { AgentUnavailableError, NotFoundError, ValidationError, type Actor } from './types';

// ---------------------------------------------------------------------------------------------
// Stored shapes (agent_messages.content)
// ---------------------------------------------------------------------------------------------

export interface TurnContextRef {
  selection?: string[];
  frameId?: string | null;
  scopeNodeId?: string;
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
    };
  }
  const c = (row.content ?? { v: 1, turns: [] }) as StoredAssistantContent;
  const texts = (c.turns ?? [])
    .filter((t) => t.role === 'assistant')
    .flatMap((t) => blocksText(typeof t.content === 'string' ? [t.content] : t.content));
  if (c.partial) texts.push(...blocksText(c.partial));
  return {
    ...base,
    text: texts.filter(Boolean).join('\n\n'),
    activity: c.activity ?? [],
    touched: c.touched ?? [],
    jobSuggestion: c.startedJob ? null : (c.jobSuggestion ?? null),
    questions: c.questions?.set ?? null,
    answers: c.answers ?? null,
    answersFor: null,
    startedJobMessageId: c.startedJob?.messageId ?? null,
    context: null,
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

export const sendMessageInput = z
  .object({
    projectId: z.uuid(),
    conversationId: z.uuid().optional(),
    prompt: z.string().trim().min(1).max(8000),
    model: z.string().max(100).optional(),
    selection: z.array(z.string().max(64)).max(50).optional(),
    frameId: z.string().max(64).nullish(),
    attachments: z.array(attachmentSchema).max(10).optional(),
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

/**
 * Send a chat message. Not available until Epic 4: the agent's tools edited the HTML model's
 * DesignDoc, which Story 1.2 removed, and the FigCraft tools (run in the browser through
 * `packages/bridge`) aren't built yet. The input is still validated and authorized first, so
 * callers see the same errors they will later.
 */
export async function sendMessage(db: Db, actor: Actor, raw: unknown): Promise<SentMessage> {
  assertCan(actor.role, 'agent:run');
  const parsed = sendMessageInput.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid message');
  await getProject(db, actor, parsed.data.projectId);
  throw new AgentUnavailableError();
}

/** Answer an assistant message's follow-up questions. Not available until Epic 4 (see sendMessage). */
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
