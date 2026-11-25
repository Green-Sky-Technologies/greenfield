'use client';

/**
 * Comment or ask (Story 6.2): one box at an element, two actions. Comment leaves a thread for
 * people (6.1, pinned to the element so it follows it); Ask Claude leaves the same thread and
 * starts an agent turn scoped to that element in one step.
 *
 * `Composer` answers the comment tool's `ui.request comment.new` (2.11) at the clicked point,
 * on the front-most layer there. The top bar and C open the same box on the selection
 * (`features/shell/comment-or-ask.tsx`). Esc closes either and returns to the canvas.
 */
import { blurEditor, focusEditor, type NodeId } from '@greenfield/bridge';
import { useEditorState, useEditorStore, useUiRequest } from '@greenfield/editor-state/react';
import { useEffect, useRef, useState } from 'react';
import { ImageIcon, Mic, NotYet } from '@/components/icons';
import { askClaude } from './ask-claude';

/**
 * What a new comment is on: a page point, and the layers there. The thread pins to the first;
 * Ask Claude's turn may change them all. None: the page itself.
 */
export interface CommentTarget {
  x: number;
  y: number;
  nodeIds: readonly NodeId[];
  name: string | null;
}

/** "Card", or "Card and 2 more". */
export const layersName = (first: string | null, count: number) =>
  first && count > 1 ? `${first} and ${count - 1} more` : first;

const WIDTH = 328;
const HEIGHT = 216;
const GAP = 16;

/** The canvas iframe (its offset turns canvas pixels into page pixels). */
export const canvasFrame = () =>
  document.querySelector<HTMLIFrameElement>('iframe[title="Design canvas"]');

/**
 * Beside a point on the canvas (canvas CSS pixels): to its right, or its left near the window's
 * edge, and always inside the window (the point may be scrolled out of view).
 */
export function placeBeside(
  at: { x: number; y: number },
  frame: { left: number; top: number },
  view: { width: number; height: number },
): { left: number; top: number } {
  const clamp = (v: number, max: number) => Math.min(Math.max(GAP, v), max);
  const right = frame.left + at.x + GAP;
  const left = right + WIDTH > view.width - GAP ? frame.left + at.x - GAP - WIDTH : right;
  return {
    left: clamp(left, view.width - WIDTH - GAP),
    top: clamp(frame.top + at.y - GAP, view.height - HEIGHT - GAP),
  };
}

interface CardProps {
  target: CommentTarget | null;
  /** Where the box goes (fixed); omitted: centred under the top bar. */
  at?: { left: number; top: number };
  canComment?: boolean;
  /** Opened to ask Claude (the context menu's "Ask Claude"): Cmd/Ctrl+Enter asks. */
  ask?: boolean;
  onClose: () => void;
}

export function ComposerCard({ target, at, canComment = true, ask, onClose }: CardProps) {
  const store = useEditorStore();
  const box = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'comment' | 'ask' | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const iframe = canvasFrame();
    const take = () => {
      // WebKit and Firefox keep focus in the editor's iframe unless both are blurred.
      if (iframe) {
        blurEditor(iframe);
        iframe.blur();
      }
      box.current?.focus();
    };
    // Opened by a click on the canvas, the editor keeps (or takes back) focus for a few frames
    // in WebKit and Firefox. Take it while the box is new and the canvas has it.
    const until = performance.now() + 1000;
    let frame = 0;
    const step = () => {
      if (document.activeElement === iframe || document.activeElement === document.body) take();
      if (performance.now() < until) frame = requestAnimationFrame(step);
    };
    take();
    step();
    return () => cancelAnimationFrame(frame);
  }, []);

  const on = target?.name ?? 'the page';
  const ready = canComment && target !== null && text.trim() !== '' && busy === null;

  async function send(action: 'comment' | 'ask') {
    if (!ready || !target) return;
    setBusy(action);
    setError(null);
    try {
      const { id } = (await store.run('comment.add', {
        x: target.x,
        y: target.y,
        text: text.trim(),
        ...(target.nodeIds[0] == null ? {} : { anchor: target.nodeIds[0] }),
      })) as { id: number };
      if (action === 'ask')
        await askClaude(store, { threadId: id, nodeIds: target.nodeIds, request: text });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <section
      role="dialog"
      aria-label="Comment or ask"
      data-testid="composer"
      className={`z-30 border border-border bg-surface p-3 text-xs shadow-[0_12px_32px_-12px_rgb(0_0_0/0.5)] ${
        at ? 'fixed' : 'absolute top-2 left-1/2 -translate-x-1/2'
      }`}
      style={at ? { left: at.left, top: at.top, width: WIDTH } : { width: WIDTH }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void send(ask ? 'ask' : 'comment');
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between text-muted">
        <span className="truncate">On {target ? on : '…'}</span>
        <button
          type="button"
          onClick={onClose}
          aria-keyshortcuts="Escape"
          className="shell-focus font-mono hover:text-text"
        >
          Esc to cancel
        </button>
      </div>
      <label htmlFor="comment-or-ask" className="sr-only">
        Comment or ask Claude
      </label>
      <textarea
        id="comment-or-ask"
        ref={box}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          ask ? `Ask Claude to change ${on}` : 'Leave a comment, or ask Claude to change something'
        }
        className="input resize-none text-sm"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <span className="mr-auto flex gap-1">
          <NotYet label="Dictate" story="Story 16.1">
            <Mic />
          </NotYet>
          <NotYet label="Add an image" story="Story 12.1">
            <ImageIcon />
          </NotYet>
        </span>
        <button
          type="button"
          disabled={!ready}
          onClick={() => void send('comment')}
          className="shell-focus h-7 border border-border px-2.5 font-medium text-text hover:bg-surface-2 disabled:opacity-50"
        >
          {busy === 'comment' ? 'Posting…' : 'Comment'}
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => void send('ask')}
          className="shell-focus flex h-7 items-center gap-1.5 bg-agent px-2.5 font-medium text-ember-ink hover:brightness-110 disabled:opacity-50"
        >
          {busy === 'ask' ? 'Asking…' : 'Ask Claude'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-danger">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-muted">
          {canComment ? (
            <>
              <strong className="font-medium text-text">Comment</strong> leaves a thread for people.{' '}
              <strong className="font-medium text-agent">Ask Claude</strong> sends it to the agent
              with {on} attached.
            </>
          ) : (
            'Viewers can’t comment.'
          )}
        </p>
      )}
    </section>
  );
}

/**
 * `ui.request comment.new`: the comment tool's click on the canvas (`{x, y}`, a page point), or
 * our context menu and floating toolbar (`{x, y, ids, ask}`: the layers, and whether to ask).
 */
interface NewComment {
  x: number;
  y: number;
  ids?: NodeId[];
  ask?: boolean;
}

export function Composer({ canComment }: { canComment: boolean }) {
  const request = useUiRequest();
  const store = useEditorStore();
  const asked = request?.kind === 'comment.new' ? (request.data as NewComment) : null;
  // Viewers can't comment: their canvas's request opens nothing.
  const data = canComment ? asked : null;
  useEffect(() => {
    if (asked && !canComment) store.requestDone();
  }, [asked, canComment, store]);
  const ids = data?.ids?.length ? data.ids : null;
  const firstName = useEditorState((s) =>
    ids ? (s.tree.nodes.get(ids[0]!)?.name ?? s.nodes.get(ids[0]!)?.name ?? null) : null,
  );
  // The layer under a click, once read; a newer request makes it stale.
  const [found, setFound] = useState<{ data: object; target: CommentTarget } | null>(null);
  const target: CommentTarget | null =
    data && ids
      ? { x: data.x, y: data.y, nodeIds: ids, name: layersName(firstName, ids.length) }
      : found && found.data === data
        ? found.target
        : null;

  useEffect(() => {
    if (!data || data.ids?.length) return;
    const done = (layer?: { id: NodeId; name: string }) =>
      setFound({
        data,
        target: {
          x: data.x,
          y: data.y,
          nodeIds: layer ? [layer.id] : [],
          name: layer?.name ?? null,
        },
      });
    store
      .run('select.layersAt', { x: data.x, y: data.y })
      .then((r) => done((r as { layers: { id: NodeId; name: string }[] }).layers[0]))
      .catch(() => done());
  }, [data, store]);

  if (!request || !data) return null;
  const frame = canvasFrame()?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const at = placeBeside(request.screen ?? { x: 0, y: 0 }, frame, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const close = () => {
    store.requestDone();
    const iframe = canvasFrame();
    if (iframe) focusEditor(iframe);
  };
  return (
    <ComposerCard
      key={`${data.x},${data.y}`}
      target={target}
      at={at}
      ask={data.ask === true}
      onClose={close}
    />
  );
}
