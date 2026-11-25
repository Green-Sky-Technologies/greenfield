'use client';

/**
 * The Comments tab (Story 6.4): the file's threads, open or resolved or yours. Choosing one
 * jumps to its element on the canvas and opens it below the list: its messages (Claude's replies
 * in ember), and Reply, Ask Claude and Resolve. Ask Claude sends the thread to the agent pane.
 */
import type { CommentMessage, CommentThread } from '@greenfield/bridge';
import type { EditorStore } from '@greenfield/editor-state';
import { useEditorState, useEditorStore } from '@greenfield/editor-state/react';
import { useState } from 'react';
import { askClaude } from './ask-claude';
import { useCommentThreads } from './threads';

type Filter = 'open' | 'resolved' | 'mine';

export function CommentsPanel() {
  const store = useEditorStore();
  const { threads, you } = useCommentThreads();
  const [filter, setFilter] = useState<Filter>('open');
  const [chosen, setChosen] = useState<number | null>(null);

  const open = threads.filter((t) => !t.resolved);
  const resolved = threads.filter((t) => t.resolved);
  const shown =
    filter === 'open'
      ? open
      : filter === 'resolved'
        ? resolved
        : threads.filter((t) => t.author === you);
  const thread = threads.find((t) => t.id === chosen) ?? null;

  const choose = (t: CommentThread) => {
    setChosen(t.id);
    void jumpTo(store, t);
  };

  return (
    <section
      data-testid="comments-panel"
      aria-label="Comments"
      className="flex min-h-0 flex-1 flex-col text-xs"
    >
      <div role="group" aria-label="Show" className="flex gap-2 border-b border-border px-4 py-3">
        {(
          [
            ['open', `Open · ${open.length}`],
            ['resolved', `Resolved · ${resolved.length}`],
            ['mine', 'Mine'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            className={`shell-focus h-6 px-2.5 ${
              filter === id
                ? 'bg-text font-medium text-bg'
                : id === 'mine'
                  ? 'text-muted hover:text-text'
                  : 'border border-border text-text hover:bg-surface-2'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="p-4 text-muted">
            {threads.length === 0
              ? 'No comments yet. Press C to comment on the selection, or ask Claude.'
              : 'Nothing here.'}
          </p>
        ) : (
          <ul aria-label="Comment threads">
            {shown.map((t) => (
              <ThreadRow
                key={t.id}
                thread={t}
                chosen={t.id === chosen}
                onChoose={() => choose(t)}
              />
            ))}
          </ul>
        )}
        {thread && <ThreadDetail key={thread.id} thread={thread} />}
      </div>
    </section>
  );
}

/** The anchor's name when it's on the page in front, else its frame or page. */
function useAnchorName(t: CommentThread): string {
  const name = useEditorState((s) =>
    t.anchor == null ? undefined : s.tree.nodes.get(t.anchor)?.name,
  );
  return name ?? t.frameName ?? t.pageName;
}

function ThreadRow({
  thread: t,
  chosen,
  onChoose,
}: {
  thread: CommentThread;
  chosen: boolean;
  onChoose: () => void;
}) {
  const on = useAnchorName(t);
  const meta = t.resolved
    ? 'Resolved'
    : t.replies.some((r) => r.agent)
      ? 'Claude replied'
      : t.replies.length
        ? `${t.replies.length} ${t.replies.length === 1 ? 'reply' : 'replies'}`
        : '';
  return (
    <li className="border-b border-border">
      <button
        type="button"
        aria-current={chosen || undefined}
        onClick={onChoose}
        className={`shell-focus block w-full border-l-2 px-4 py-3 text-left hover:bg-surface-2 ${
          chosen ? 'border-user bg-surface-2' : 'border-transparent'
        } ${t.resolved ? 'text-muted' : ''}`}
      >
        <span className="flex items-baseline gap-2">
          <span
            aria-hidden
            className={`inline-flex size-4 shrink-0 items-center justify-center font-mono text-[10px] ${
              t.resolved ? 'bg-surface-2 text-muted' : 'bg-user text-user-ink'
            }`}
          >
            {t.id}
          </span>
          <span className="font-medium text-text">{t.author}</span>
          <span className="min-w-0 flex-1 truncate text-muted">on {on}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted">{meta}</span>
        </span>
        <span className="mt-1.5 block line-clamp-2">{t.text}</span>
      </button>
    </li>
  );
}

function ThreadDetail({ thread: t }: { thread: CommentThread }) {
  const store = useEditorStore();
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const postReply = async () => {
    const text = reply.trim();
    if (!text) return;
    await store.run('comment.reply', { id: t.id, text });
    setReply('');
    return text;
  };

  return (
    <article aria-label={`Thread ${t.id}`} className="space-y-3 px-4 py-4">
      {[t as CommentMessage, ...t.replies].map((m, i) => (
        <Message key={i} message={m} />
      ))}
      <label className="block">
        <span className="sr-only">Reply or ask Claude</span>
        <textarea
          rows={2}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Reply, or tell Claude what to do"
          className="input resize-none text-xs"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !reply.trim()}
          onClick={() => void act(postReply)}
          className="shell-focus h-7 border border-border px-2.5 hover:bg-surface-2 disabled:opacity-50"
        >
          Reply
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const request = await postReply();
              await askClaude(store, {
                threadId: t.id,
                nodeIds: t.anchor == null ? [] : [t.anchor],
                request,
              });
            })
          }
          className="shell-focus h-7 bg-agent px-2.5 font-medium text-ember-ink hover:brightness-110 disabled:opacity-50"
        >
          Ask Claude
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void act(() => store.run('comment.resolve', { id: t.id, resolved: !t.resolved }))
          }
          className="shell-focus h-7 px-2 text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50"
        >
          {t.resolved ? 'Reopen' : '✓ Resolve'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </article>
  );
}

function Message({ message: m }: { message: CommentMessage }) {
  return (
    <div>
      <p className={`type-label ${m.agent ? 'text-agent' : 'text-user'}`}>{m.author}</p>
      <p className="mt-1 text-sm whitespace-pre-wrap text-text">{m.text}</p>
    </div>
  );
}

/** Show the thread's element: its page, the layer selected and in view (or the pin, on a page). */
async function jumpTo(store: EditorStore, t: CommentThread) {
  try {
    if (!store.getState().pages.find((p) => p.id === t.page)?.current)
      await store.run('page.select', { id: t.page });
    if (t.anchor == null) return void (await store.run('comment.zoom', { ids: [t.id] }));
    await store.run('select.set', { ids: [t.anchor] });
    await store.run('view.zoomSelection', {});
  } catch {
    // The layer or page is gone: the thread still reads in the list.
  }
}
