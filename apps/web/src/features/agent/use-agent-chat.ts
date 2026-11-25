'use client';

/**
 * The project chat's client side (Stories 4.2, 4.4, 4.5, 4.7, 5.2): load it, send a message
 * with the selection's context, follow each reply's SSE stream and run its tool calls through
 * the editor (`ToolRunner`), and the actions on a reply: stop, retry, answer its questions,
 * start the job it offered, undo its changes.
 *
 * A message sent while a reply runs waits in `queued` and goes when the reply ends. Leaving the
 * page cancels running replies (a beacon; the server also cancels once the stream stops).
 */
import type { BatchStep, Editor } from '@greenfield/bridge';
import {
  buildTurnContext,
  planRevert,
  type JobKind,
  type QuestionAnswer,
} from '@greenfield/contracts';
import { useEditorStore } from '@greenfield/editor-state/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageView } from '@/server/services/agent';
import { onAskClaude } from './ask';
import { activityLabel } from './format';
import { fetchToolRunnerApi, ToolRunner, whenDocumentVisible } from './tool-runner';

export const ACTIVE = new Set(['pending', 'streaming']);
export const isRunning = (m: MessageView) => m.role === 'assistant' && ACTIVE.has(m.status);

export interface ActivityItem {
  id: string;
  label: string;
  status: 'running' | 'done' | 'error';
}

interface Queued {
  prompt: string;
  scope: number[] | null;
}

interface Chat {
  conversationId: string | null;
  messages: MessageView[];
}

interface Sent {
  conversationId?: string;
  messageId?: string;
  message?: string;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await r.json().catch(() => ({}))) as T & { message?: string };
  if (!r.ok) throw new Error(json.message ?? `Request failed (${r.status})`);
  return json;
}

const messageUrl = (id: string, action: string) =>
  `/api/agent/messages/${encodeURIComponent(id)}/${action}`;

/** The layers a user message was sent with (its scope), or null for the whole page. */
export function sentScope(m: MessageView | undefined): number[] | null {
  const ids = m?.context?.scope ?? m?.context?.selection?.map(Number) ?? [];
  const valid = ids.filter((n) => Number.isInteger(n) && n >= 0);
  return valid.length ? valid : null;
}

/** The input a job offer starts (Story 4.5), with the current selection as a fallback frame. */
function jobRequest(
  s: NonNullable<MessageView['jobSuggestion']>,
  selection: readonly number[],
): { kind: JobKind; input: unknown } {
  const frames = s.frameIds?.length ? s.frameIds : selection.map(String);
  switch (s.kind) {
    case 'generate':
      return { kind: 'generate', input: { prompt: s.prompt } };
    case 'redesign':
      return { kind: 'redesign', input: { prompt: s.prompt, frameIds: frames } };
    case 'alternatives':
      return {
        kind: 'alternatives',
        input: { prompt: s.prompt, frameId: frames[0] ?? '', count: s.count ?? 3 },
      };
  }
}

export function useAgentChat(projectId: string, editor: () => Editor | null) {
  const store = useEditorStore();
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [activity, setActivity] = useState<Record<string, ActivityItem[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);
  const queue = useRef<Queued | null>(null);
  /** Runs when a reply's stream ends (set below, once `post` exists). */
  const replyEnded = useRef(() => {});
  const conversationId = useRef<string | null>(null);
  const runner = useRef<ToolRunner | null>(null);
  const streams = useRef(new Map<string, EventSource>());

  const upsert = useCallback((view: MessageView) => {
    setMessages((ms) => {
      const i = ms.findIndex((m) => m.id === view.id);
      if (i < 0) return [...ms, view].sort((a, b) => a.seq - b.seq);
      const next = [...ms];
      next[i] = view;
      return next;
    });
    if (!view.toolCalls.length) return;
    // The view only carries the current step's calls: keep every step's for the turn's list.
    setActivity((all) => {
      const items = new Map((all[view.id] ?? []).map((a) => [a.id, a]));
      for (const call of view.toolCalls) {
        const status = view.activity.find((a) => a.id === call.id)?.status ?? 'running';
        items.set(call.id, { id: call.id, label: activityLabel(call, view.checking), status });
      }
      return { ...all, [view.id]: [...items.values()] };
    });
  }, []);

  const follow = useCallback(
    (messageId: string) => {
      if (streams.current.has(messageId)) return;
      const es = new EventSource(messageUrl(messageId, 'stream'));
      streams.current.set(messageId, es);
      es.addEventListener('message', (e) => {
        const view = JSON.parse((e as MessageEvent<string>).data) as MessageView;
        upsert(view);
        void runner.current?.handle(view);
      });
      es.addEventListener('done', () => {
        es.close();
        streams.current.delete(messageId);
        runner.current?.end(messageId);
        replyEnded.current();
      });
    },
    [upsert],
  );

  const reload = useCallback(
    () =>
      fetch(`/api/agent/chat?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<Chat>) : null))
        .then((chat) => {
          if (!chat) return;
          conversationId.current = chat.conversationId;
          setMessages(chat.messages);
          for (const m of chat.messages) if (isRunning(m)) follow(m.id);
        }),
    [projectId, follow],
  );

  useEffect(() => {
    runner.current = new ToolRunner({
      editor,
      api: fetchToolRunnerApi(),
      clientId: crypto.randomUUID().replaceAll('-', ''),
      whenVisible: () => whenDocumentVisible(),
      onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    });
    reload().catch(() => {});
    const onPageHide = () => {
      for (const id of streams.current.keys()) navigator.sendBeacon(messageUrl(id, 'cancel'));
    };
    window.addEventListener('pagehide', onPageHide);
    const open = streams.current;
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      for (const es of open.values()) es.close();
      open.clear();
    };
    // `editor` is a stable getter; one runner per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /** Run `act` as the pane's one request at a time; its error shows under the chat. */
  const attempt = async (act: () => Promise<void>) => {
    setSending(true);
    setError(null);
    try {
      await act();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  /** The `<document>` context for a turn on `scope` (null: the current selection). */
  const context = async (scope: number[] | null) => {
    const ed = editor();
    if (!ed) throw new Error('The editor is not open yet');
    await whenDocumentVisible();
    return buildTurnContext(ed, scope ? { selection: scope } : {});
  };

  const started = async (sent: Sent) => {
    if (!sent.messageId) throw new Error(sent.message ?? 'Send failed');
    await reload();
    follow(sent.messageId);
  };

  const post = (prompt: string, scope: number[] | null) =>
    attempt(async () => {
      const ctx = await context(scope);
      await started(
        await postJson<Sent>('/api/agent/messages', {
          projectId,
          ...(conversationId.current ? { conversationId: conversationId.current } : {}),
          prompt,
          context: ctx.text,
          scope: ctx.scope,
          selection: (ctx.scope ?? []).map(String),
        }),
      );
    });

  const running = messages.some(isRunning);

  /** Send `prompt` on `scope`, or queue it behind the running reply. */
  const sendOn = (prompt: string, scope: number[] | null) => {
    if (!running) return post(prompt, scope);
    queue.current = { prompt, scope };
    setQueued(prompt);
    return Promise.resolve();
  };
  const ask = useRef(sendOn);
  useEffect(() => onAskClaude((a) => void ask.current(a.prompt, a.scope)), []);

  useEffect(() => {
    ask.current = sendOn;
    // A queued message goes once the reply before it ends.
    replyEnded.current = () => {
      const next = queue.current;
      if (!next) return;
      queue.current = null;
      setQueued(null);
      void post(next.prompt, next.scope);
    };
  });

  return {
    messages,
    activity,
    error,
    sending,
    running,
    queued,

    /** Send `prompt` with the current selection (queued behind a running reply). */
    send(prompt: string) {
      const scope = store.getState().selection;
      return sendOn(prompt, scope.length ? [...scope] : null);
    },

    async cancel(id: string) {
      runner.current?.end(id);
      await fetch(messageUrl(id, 'cancel'), { method: 'POST' });
    },

    /** Send the request behind a failed or stopped reply again, on the layers it was sent with. */
    retry(reply: MessageView) {
      const asked = messages.findLast((m) => m.role === 'user' && m.seq < reply.seq);
      if (!asked) return Promise.resolve();
      return post(asked.text, sentScope(asked));
    },

    /** Answer the reply's follow-up questions, or let Claude decide (`skip`) (Story 4.4). */
    answer(reply: MessageView, answers: QuestionAnswer[] | 'skip') {
      const asked = messages.findLast((m) => m.role === 'user' && m.seq < reply.seq);
      return attempt(async () => {
        const ctx = await context(sentScope(asked));
        await started(
          await postJson<Sent>(messageUrl(reply.id, 'answer'), {
            ...(answers === 'skip' ? { skip: true } : { answers }),
            context: ctx.text,
          }),
        );
      });
    },

    /** Start the background job a reply offered (Story 4.5); its card follows it. */
    startJob(reply: MessageView) {
      const s = reply.jobSuggestion;
      if (!s) return Promise.resolve();
      return attempt(async () => {
        await postJson('/api/jobs', {
          ...jobRequest(s, store.getState().selection),
          projectId,
          conversationId: reply.conversationId,
          messageId: reply.id,
        });
        await reload();
      });
    },

    /**
     * "Undo all" (Story 4.7): undo the turn's steps if they are still the newest, else write the
     * old values back in one step. Returns the layers it couldn't bring back (removed ones).
     */
    async revert(reply: MessageView): Promise<number> {
      let lost = 0;
      await attempt(async () => {
        const ed = editor();
        if (!ed) throw new Error('The editor is not open yet');
        const { history } = await ed.inspect({ depth: 0, fields: [] });
        const plan = planRevert(reply.changes, reply.undoLabels, history.undo);
        if (plan.kind === 'undo')
          for (let i = 0; i < plan.steps; i++) await store.run('edit.undo', {});
        else {
          if (plan.commands.length)
            await store.batch(plan.commands as BatchStep[], { label: 'Undo Claude’s changes' });
          lost = plan.unrestorable.length;
        }
        upsert(await postJson<MessageView>(messageUrl(reply.id, 'revert'), { how: plan.kind }));
      });
      return lost;
    },
  };
}

export type AgentChat = ReturnType<typeof useAgentChat>;
