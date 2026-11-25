'use client';

/**
 * The Agent tab (stub for lane W2-F, Stories 5.2 and 5.5): until then, Story 4.2's minimum to
 * drive an interactive agent turn: a prompt box, the replies, and the tool runner. The real agent
 * pane (layer-by-layer changes, Undo all, question cards) should reuse `ToolRunner` and the
 * send/stream flow here.
 *
 * Per message: build the turn context from the editor (Story 4.1), POST it, follow the reply's
 * SSE stream, and run its tool calls through the editor as they arrive. Leaving the page
 * cancels a running reply (a beacon; the server also cancels once the stream stops).
 */
import { buildTurnContext } from '@greenfield/contracts';
import type { Editor } from '@greenfield/bridge';
import { useEffect, useRef, useState } from 'react';
import type { MessageView } from '@/server/services/agent';
import { fetchToolRunnerApi, ToolRunner, whenDocumentVisible } from './tool-runner';

interface Props {
  projectId: string;
  editor: () => Editor | null;
}

const ACTIVE = new Set(['pending', 'streaming']);

export function AgentPane({ projectId, editor }: Props) {
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runner = useRef<ToolRunner | null>(null);
  const streams = useRef(new Map<string, EventSource>());

  const upsert = (view: MessageView) =>
    setMessages((ms) => {
      const i = ms.findIndex((m) => m.id === view.id);
      if (i < 0) return [...ms, view];
      const next = [...ms];
      next[i] = view;
      return next;
    });

  const follow = (messageId: string) => {
    if (streams.current.has(messageId)) return;
    const es = new EventSource(`/api/agent/messages/${encodeURIComponent(messageId)}/stream`);
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
    });
  };

  useEffect(() => {
    const clientId = crypto.randomUUID().replaceAll('-', '');
    runner.current = new ToolRunner({
      editor,
      api: fetchToolRunnerApi(),
      clientId,
      whenVisible: () => whenDocumentVisible(),
      onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    });
    let cancelled = false;
    fetch(`/api/agent/chat?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((chat: { conversationId: string | null; messages: MessageView[] } | null) => {
        if (cancelled || !chat) return;
        setConversationId(chat.conversationId);
        setMessages(chat.messages);
        for (const m of chat.messages) if (ACTIVE.has(m.status)) follow(m.id);
      })
      .catch(() => {});
    // Closing the tab cancels running replies (the server would after its lease, too).
    const onPageHide = () => {
      for (const id of streams.current.keys())
        navigator.sendBeacon(`/api/agent/messages/${encodeURIComponent(id)}/cancel`);
    };
    window.addEventListener('pagehide', onPageHide);
    const open = streams.current;
    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', onPageHide);
      for (const es of open.values()) es.close();
      open.clear();
    };
    // `editor` is a stable getter; one runner per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = prompt.trim();
    const ed = editor();
    if (!text || !ed) return;
    setBusy(true);
    setError(null);
    try {
      await whenDocumentVisible();
      const ctx = await buildTurnContext(ed);
      const r = await fetch('/api/agent/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId,
          ...(conversationId ? { conversationId } : {}),
          prompt: text,
          context: ctx.text,
          scope: ctx.scope,
          selection: (ctx.scope ?? []).map(String),
        }),
      });
      const body = (await r.json()) as {
        conversationId?: string;
        userMessageId?: string;
        messageId?: string;
        message?: string;
      };
      if (!r.ok || !body.messageId) throw new Error(body.message ?? `Send failed (${r.status})`);
      setConversationId(body.conversationId ?? null);
      setPrompt('');
      const chat = await fetch(`/api/agent/chat?projectId=${encodeURIComponent(projectId)}`, {
        cache: 'no-store',
      }).then((x) => x.json() as Promise<{ messages: MessageView[] }>);
      setMessages(chat.messages);
      follow(body.messageId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    runner.current?.end(id);
    await fetch(`/api/agent/messages/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  }

  return (
    <section
      data-testid="agent-panel"
      className="flex min-h-0 flex-1 flex-col text-sm"
      aria-label="Agent"
    >
      <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.map((m) => (
          <li key={m.id} data-testid="agent-message" data-role={m.role} data-status={m.status}>
            <div className="text-xs opacity-60">
              {m.role === 'user' ? 'You' : 'Claude'}
              {m.role === 'assistant' && m.status !== 'complete' && ` · ${m.status}`}
            </div>
            <p className="whitespace-pre-wrap">{m.text}</p>
            {m.activity.length > 0 && (
              <ul className="mt-1 text-xs opacity-60">
                {m.activity.map((a) => (
                  <li key={a.id}>
                    {a.name}: {a.status}
                  </li>
                ))}
              </ul>
            )}
            {m.error && (
              <p role="alert" className="text-xs">
                {m.error}
              </p>
            )}
            {m.role === 'assistant' && ACTIVE.has(m.status) && (
              <button type="button" className="btn-link text-xs" onClick={() => cancel(m.id)}>
                Stop
              </button>
            )}
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" className="px-3 text-xs">
          {error}
        </p>
      )}
      <form onSubmit={send} className="flex flex-col gap-2 border-t p-3">
        <textarea
          aria-label="Ask the agent"
          className="input min-h-16"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask Claude to change the selection…"
        />
        <button type="submit" className="btn-primary" disabled={busy || !prompt.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
