'use client';

/**
 * The open file's comment threads (Story 6.1 keeps them in the file). Read with `comment.list`
 * when the document changes (every comment edit is an undo step, so it changes the document),
 * never on a timer. Reads don't pile up: while one is out, later changes ask for one more.
 */
import type { CommentThread } from '@greenfield/bridge';
import type { EditorStore } from '@greenfield/editor-state';
import { useDocument, useEditorStore } from '@greenfield/editor-state/react';
import { useEffect, useSyncExternalStore } from 'react';

export interface ThreadsSnapshot {
  threads: readonly CommentThread[];
  /** The name this editor writes comments as (`comment.people`'s `you`). */
  you: string | null;
}

const EMPTY: ThreadsSnapshot = { threads: [], you: null };

class CommentThreads {
  private snapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private reading = false;
  private again = false;

  constructor(private readonly store: EditorStore) {}

  readonly get = () => this.snapshot;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  clear() {
    this.set(EMPTY);
  }

  refresh(): void {
    if (this.reading) {
      this.again = true;
      return;
    }
    this.reading = true;
    Promise.all([
      this.store.run('comment.list', { page: 'all' }) as Promise<{ comments: CommentThread[] }>,
      this.snapshot.you === null
        ? (this.store.run('comment.people', {}) as Promise<{ you: string }>)
        : Promise.resolve({ you: this.snapshot.you }),
    ])
      .then(([list, people]) => this.set({ threads: list.comments, you: people.you }))
      .catch(() => {}) // no editor or no file: the list stays as it was
      .finally(() => {
        this.reading = false;
        if (this.again) {
          this.again = false;
          this.refresh();
        }
      });
  }

  private set(next: ThreadsSnapshot) {
    this.snapshot = next;
    for (const l of [...this.listeners]) l();
  }
}

const byStore = new WeakMap<EditorStore, CommentThreads>();

function threadsOf(store: EditorStore): CommentThreads {
  let t = byStore.get(store);
  if (!t) byStore.set(store, (t = new CommentThreads(store)));
  return t;
}

/** The threads, kept in step with the document. Mount it once (the Comments panel). */
export function useCommentThreads(): ThreadsSnapshot {
  const threads = threadsOf(useEditorStore());
  const doc = useDocument();
  useEffect(() => {
    if (doc) threads.refresh();
    else threads.clear();
  }, [doc, threads]);
  return useSyncExternalStore(threads.subscribe, threads.get, () => EMPTY);
}
