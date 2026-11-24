'use client';

/**
 * "Comment or ask" (Story 5.1 / 5.4): opened with C or the top bar. A placeholder until comments
 * in the file (6.1) and Ask Claude (6.2) land: it takes focus, holds a draft, and closes with Esc
 * (which returns focus to the canvas).
 */
import { useEffect, useRef } from 'react';

interface Props {
  canComment: boolean;
  onClose: () => void;
}

export function CommentOrAsk({ canComment, onClose }: Props) {
  const text = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    text.current?.focus();
  }, []);

  return (
    <section
      role="dialog"
      aria-label="Comment or ask"
      className="absolute top-2 left-1/2 z-20 w-[min(26rem,calc(100%-2rem))] -translate-x-1/2 border border-border bg-surface shadow-[0_12px_32px_-12px_rgb(7_54_66/0.4)]"
    >
      <label htmlFor="comment-or-ask" className="sr-only">
        Comment or ask Claude
      </label>
      <textarea
        id="comment-or-ask"
        ref={text}
        rows={3}
        placeholder="Leave a comment, or ask Claude to change something"
        className="block w-full resize-none border-0 bg-transparent px-3 pt-3 pb-2 text-sm text-text outline-none placeholder:text-muted"
      />
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <p className="flex-1 text-xs text-muted">
          {canComment
            ? 'Posting comments and asking Claude are coming soon.'
            : 'Viewers can’t comment.'}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="shell-focus h-7 px-2 text-xs text-muted hover:bg-surface-2 hover:text-text"
          aria-keyshortcuts="Escape"
        >
          Close
        </button>
        <button
          type="button"
          disabled
          className="h-7 border border-border px-2.5 text-xs font-medium text-text disabled:opacity-50"
        >
          Comment
        </button>
        <button
          type="button"
          disabled
          className="flex h-7 items-center gap-1.5 border border-agent px-2.5 text-xs font-medium text-agent disabled:opacity-60"
        >
          <span aria-hidden className="size-1.5 bg-agent" />
          Ask Claude
        </button>
      </div>
    </section>
  );
}
