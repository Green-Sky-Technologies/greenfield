'use client';

/**
 * The embedded editor (FigCraft, served from /editor/), driven through `@greenfield/bridge`:
 *
 *   ready  load the project's document from storage and `open` it
 *   dirty  the indicator in the bar
 *   save   PUT the document to storage (the bridge acks `figcraft:saved {id}` when it settles)
 *   failed show the error
 *
 * Bytes are never logged. The status element's data-* attributes are what the Playwright specs
 * read. The shell (features/shell) gets the bridge through `onEditor`.
 */
import { createBridge, type Editor } from '@greenfield/bridge';
import { useEffect, useRef, useState } from 'react';

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

export function EditorEmbed({ projectId, author, canEdit, webgl, onEditor }: Props) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    const frame = iframe.current;
    if (!frame) return;
    const started = performance.now();
    let docName: string | null = null; // the name the editor knows the document by
    const api = `/api/projects/${encodeURIComponent(projectId)}/file`;
    // Sets the iframe's src once it listens: `ready` is posted once and never repeated.
    const editor = createBridge({ iframe: frame, author, query: webgl ? { webgl: true } : {} });
    const handle = { editor, iframe: frame };
    if (process.env.NODE_ENV !== 'production') window.__greenfieldBridge = handle;
    onEditorRef.current?.(handle);

    async function openFromStorage() {
      const r = await fetch(api, { cache: 'no-store' });
      setStorage(r.headers.get('x-storage'));
      if (r.status === 204) {
        setStatus('empty');
        return;
      }
      if (!r.ok) throw new Error(`Load failed (${r.status})`);
      const name = decodeURIComponent(r.headers.get('x-file-name') ?? 'Untitled.figcraft');
      const bytes = await r.arrayBuffer();
      docName = name;
      editor.open(name, bytes);
      setStatus('opened');
    }

    const fail = (e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    };

    const offs = [
      editor.onReady(() => {
        setReadyMs(Math.round(performance.now() - started));
        setStatus('ready');
        openFromStorage().catch(fail);
      }),
      editor.onDirty((d) => {
        dirtyRef.current = d;
        setDirty(d);
      }),
      editor.onSave(async ({ name, bytes, saveAs, id }) => {
        // Store the document itself; exports (images, PDF, .fig copies) are Epic 7.
        const isDocument = name === docName || (saveAs && /\.figcraft$/i.test(name));
        setLastSave(`${name} saveAs=${String(saveAs)} id=${id === undefined ? '-' : 'yes'}`);
        if (!isDocument || !canEdit) return;
        const t0 = performance.now();
        setStatus('saving');
        try {
          const r = await fetch(api, {
            method: 'PUT',
            headers: { 'content-type': 'application/octet-stream' },
            body: bytes as Uint8Array<ArrayBuffer>,
          });
          if (!r.ok) throw new Error(`Save failed (${r.status})`);
          const body = (await r.json()) as { size: number; storage: string };
          docName = name;
          setLastSaveMs(Math.round(performance.now() - t0));
          setLastSize(body.size);
          setStorage(body.storage);
          setSaves((n) => n + 1);
          setStatus('saved');
        } catch (e) {
          fail(e);
          throw e; // no `figcraft:saved` for a save that didn't land
        }
      }),
      editor.onFailed((e) => fail(new Error(`Editor failed: ${e}`))),
    ];

    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtyRef.current) e.preventDefault();
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      for (const off of offs) off();
      window.removeEventListener('beforeunload', onBeforeUnload);
      onEditorRef.current?.(null);
      if (window.__greenfieldBridge === handle) delete window.__greenfieldBridge;
      editor.dispose();
    };
  }, [projectId, canEdit, author, webgl]);

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
        data-last-save={lastSave}
        className="flex items-center gap-3 border-b px-4 py-1 text-xs"
      >
        <span>{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <span className="opacity-60">{status}</span>
        {storage && <span className="opacity-60">storage: {storage}</span>}
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
