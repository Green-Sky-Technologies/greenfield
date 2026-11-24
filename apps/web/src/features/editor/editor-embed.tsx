'use client';

/**
 * The embedded editor, driven through `@greenfield/bridge` (FigCraft's `?host=parent` protocol
 * plus `window.figcraft`).
 *
 *   ready -> load the project's document and open it; with nothing saved yet, `file.new` opens a
 *            blank document named after the project (Story 3.7) instead of the home screen
 *   dirty -> the indicator in the bar
 *   save  -> store the document (design-file-client: Blob upload + commit, or PUT); the bridge
 *            acks the editor only once it's stored, so a refused save stays unsaved
 *
 * Editors hold the project's edit lock while the tab is open; a save from a stale lock is
 * refused by the server (Story 3.1). The status element's data-* attributes are what the
 * Playwright specs read. Bytes are never logged. The shell (features/shell) gets the bridge
 * through `onEditor`.
 */
import { createBridge, EditorHiddenError, type Editor, type SaveEvent } from '@greenfield/bridge';
import { useEffect, useRef, useState } from 'react';
import { designFileClient, holdEditLock, type LockStatus } from './design-file-client';

type Status = 'loading' | 'ready' | 'opened' | 'empty' | 'saving' | 'saved' | 'error';

/** The bridge and the iframe it drives, for the shell (focus, keys, zoom). */
export interface EditorHandle {
  editor: Editor;
  iframe: HTMLIFrameElement;
}

declare global {
  interface Window {
    /** Dev and test builds only: lets `@greenfield/bridge/playwright` drive this page's editor. */
    __greenfieldBridge?: EditorHandle;
  }
}

/**
 * FigCraft's file tab strip (home, file tabs, new tab, theme) is this tall. Until the fork can hide
 * it (Story 2.6), the iframe is pulled up under the app's top bar so the strip is covered.
 */
const EDITOR_TAB_STRIP_PX = 40;

interface Props {
  projectId: string;
  author: string;
  canEdit: boolean;
  webgl?: boolean;
  onEditor?: (handle: EditorHandle | null) => void;
}

/** Run a control call now, or once the tab is visible again (hidden tabs draw no frames). */
async function whenVisible<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!(e instanceof EditorHiddenError)) throw e;
    await new Promise<void>((resolve) => {
      const on = () => {
        if (document.visibilityState === 'hidden') return;
        document.removeEventListener('visibilitychange', on);
        resolve();
      };
      document.addEventListener('visibilitychange', on);
    });
    return run();
  }
}

export function EditorEmbed({ projectId, author, canEdit, webgl, onEditor }: Props) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lock, setLock] = useState<LockStatus | null>(null);
  const [saves, setSaves] = useState(0);
  const [readyMs, setReadyMs] = useState<number | null>(null);
  const [lastSaveMs, setLastSaveMs] = useState<number | null>(null);
  const [lastSize, setLastSize] = useState<number | null>(null);
  const [storage, setStorage] = useState<string | null>(null);
  const [lastSave, setLastSave] = useState<string>('');
  const dirtyRef = useRef(false);
  const onEditorRef = useRef(onEditor);
  useEffect(() => {
    onEditorRef.current = onEditor;
  });
  // One session per mounted editor, kept across effect re-runs: a late lock request from an
  // earlier run must not move the lock away from the current one.
  const session = useRef<string | null>(null);

  useEffect(() => {
    const el = iframe.current;
    if (!el) return;
    const started = performance.now();
    const sessionId = (session.current ??= crypto.randomUUID());
    const files = designFileClient(projectId, sessionId);
    let docName: string | null = null; // the name the editor knows the document by
    const fail = (e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    };

    const editor: Editor = createBridge({
      iframe: el,
      author,
      query: webgl ? { webgl: true } : {},
    });
    const handle = { editor, iframe: el };
    if (process.env.NODE_ENV !== 'production') window.__greenfieldBridge = handle;
    onEditorRef.current?.(handle);
    const stopLock = canEdit ? holdEditLock(projectId, sessionId, setLock) : () => {};

    async function openDocument() {
      const file = await files.load();
      setStorage(file.storage);
      docName = file.name;
      if (file.bytes) {
        editor.open(file.name, file.bytes);
        setStatus('opened');
      } else {
        // Nothing saved yet: a blank document, not the editor's home screen (Story 3.7). The
        // editor adds the extension itself.
        await whenVisible(() =>
          editor.execute('file.new', { name: file.name.replace(/\.figcraft$/i, '') }),
        );
        setStatus('empty');
      }
    }

    async function store(e: SaveEvent) {
      // Store the document itself; exports (images, PDF, .fig copies) are Epic 7.
      const isDocument = e.name === docName || (e.saveAs && /\.figcraft$/i.test(e.name));
      setLastSave(`${e.name} saveAs=${String(e.saveAs)} id=${e.id === undefined ? '-' : 'yes'}`);
      if (!isDocument || !canEdit) return;
      const t0 = performance.now();
      setStatus('saving');
      try {
        const r = await files.save(e.bytes);
        docName = e.name;
        setLastSaveMs(Math.round(performance.now() - t0));
        setLastSize(r.size);
        setStorage(r.storage);
        setSaves((n) => n + 1);
        setError(null);
        setStatus('saved');
      } catch (err) {
        fail(err);
        throw err; // no ack: the editor keeps the changes marked unsaved
      }
    }

    const offs = [
      editor.onReady(() => {
        setReadyMs(Math.round(performance.now() - started));
        setStatus('ready');
        openDocument().catch(fail);
      }),
      editor.onDirty((d) => {
        dirtyRef.current = d;
        setDirty(d);
      }),
      editor.onSave(store),
      editor.onFailed((msg) => fail(new Error(`Editor failed: ${msg}`))),
    ];

    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtyRef.current) e.preventDefault();
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      for (const off of offs) off();
      onEditorRef.current?.(null);
      if (window.__greenfieldBridge === handle) delete window.__greenfieldBridge;
      editor.dispose();
      stopLock();
    };
  }, [projectId, author, canEdit, webgl]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        data-testid="editor-status"
        data-status={status}
        data-dirty={String(dirty)}
        data-saves={saves}
        data-ready-ms={readyMs ?? ''}
        data-save-ms={lastSaveMs ?? ''}
        data-save-size={lastSize ?? ''}
        data-storage={storage ?? ''}
        data-lock={lock ?? ''}
        data-last-save={lastSave}
        className="flex items-center gap-3 border-b px-4 py-1 text-xs"
      >
        <span>{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <span className="opacity-60">{status}</span>
        {storage && <span className="opacity-60">storage: {storage}</span>}
        {lock === 'held-by-other' && <span>Someone else is editing. Your changes won’t save.</span>}
        {lock === 'lost' && <span>Your edit lock moved or expired. Reload to keep editing.</span>}
        {error && <span role="alert">{error}</span>}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <iframe
          ref={iframe}
          title="Design canvas"
          className="absolute inset-x-0 bottom-0 w-full border-0"
          style={{ top: -EDITOR_TAB_STRIP_PX, height: `calc(100% + ${EDITOR_TAB_STRIP_PX}px)` }}
          allow="fullscreen; clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
}
