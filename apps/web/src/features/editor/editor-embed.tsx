'use client';

/**
 * The embedded editor: host side of FigCraft's `?host=parent` protocol (craft-web-host v1).
 *
 *   ready  (app -> host)  load the project's document from storage and send `open`
 *   open   (host -> app)  { name, bytes } (ArrayBuffer, transferred)
 *   dirty  (app -> host)  { dirty } -> the indicator in the bar
 *   save   (app -> host)  { name, bytes, saveAs, id? } -> PUT to storage; `saved { id }` back
 *   failed (app -> host)  { error }
 *
 * Only messages from the iframe's own window on our own origin are accepted. Bytes are never
 * logged. The status element's data-* attributes are what the Playwright spec reads.
 *
 * Promoted from the Story 0.1 spike (Story 1.2). Story 1.3 moves the protocol into
 * `packages/bridge`; until then this is the only code that talks to the editor.
 */
import { useEffect, useRef, useState } from 'react';

type Status = 'loading' | 'ready' | 'opened' | 'empty' | 'saving' | 'saved' | 'error';

interface Props {
  projectId: string;
  author: string;
  canEdit: boolean;
  webgl?: boolean;
}

export function EditorEmbed({ projectId, author, canEdit, webgl }: Props) {
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

  const src =
    `/editor/index.html?host=parent&control&author=${encodeURIComponent(author)}` +
    (webgl ? '&webgl' : '');

  useEffect(() => {
    const started = performance.now();
    let docName: string | null = null; // the name the editor knows the document by
    const api = `/api/projects/${encodeURIComponent(projectId)}/file`;
    const post = (msg: unknown, transfer: Transferable[] = []) =>
      iframe.current?.contentWindow?.postMessage(msg, window.location.origin, transfer);

    async function openFromStorage() {
      const r = await fetch(api, { cache: 'no-store' });
      setStorage(r.headers.get('x-storage'));
      if (r.status === 204) {
        // Nothing saved yet: start a new document so there is something to edit.
        setStatus('empty');
        return;
      }
      if (!r.ok) throw new Error(`Load failed (${r.status})`);
      const name = decodeURIComponent(r.headers.get('x-file-name') ?? 'Untitled.figcraft');
      const bytes = await r.arrayBuffer();
      docName = name;
      post({ type: 'figcraft:open', name, bytes }, [bytes]);
      setStatus('opened');
    }

    async function store(msg: {
      name: string;
      bytes: ArrayBuffer;
      saveAs?: boolean;
      id?: unknown;
    }) {
      // Store the document itself; exports (images, PDF, .fig copies) are Epic 7.
      const isDocument =
        msg.name === docName || (msg.saveAs === true && /\.figcraft$/i.test(msg.name));
      setLastSave(
        `${msg.name} saveAs=${String(msg.saveAs)} id=${msg.id === undefined ? '-' : 'yes'}`,
      );
      if (!isDocument || !canEdit) return;
      const t0 = performance.now();
      setStatus('saving');
      const r = await fetch(api, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: msg.bytes,
      });
      if (!r.ok) throw new Error(`Save failed (${r.status})`);
      const body = (await r.json()) as { size: number; storage: string };
      docName = msg.name;
      if (msg.id !== undefined) post({ type: 'figcraft:saved', id: msg.id });
      setLastSaveMs(Math.round(performance.now() - t0));
      setLastSize(body.size);
      setStorage(body.storage);
      setSaves((n) => n + 1);
      setStatus('saved');
    }

    const fail = (e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    };

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (!iframe.current || event.source !== iframe.current.contentWindow) return;
      const msg = event.data as { type?: unknown } | null;
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
      switch (msg.type) {
        case 'figcraft:ready':
          setReadyMs(Math.round(performance.now() - started));
          setStatus('ready');
          openFromStorage().catch(fail);
          break;
        case 'figcraft:dirty': {
          const d = (msg as { dirty?: unknown }).dirty === true;
          dirtyRef.current = d;
          setDirty(d);
          break;
        }
        case 'figcraft:save': {
          const m = msg as { name?: unknown; bytes?: unknown; saveAs?: unknown; id?: unknown };
          if (typeof m.name !== 'string' || !(m.bytes instanceof ArrayBuffer)) return;
          store({ name: m.name, bytes: m.bytes, saveAs: m.saveAs === true, id: m.id }).catch(fail);
          break;
        }
        case 'figcraft:failed':
          fail(new Error(`Editor failed: ${String((msg as { error?: unknown }).error)}`));
          break;
      }
    }

    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtyRef.current) e.preventDefault();
    }

    window.addEventListener('message', onMessage);
    window.addEventListener('beforeunload', onBeforeUnload);
    // Load the editor only once we're listening: `ready` is posted once and never repeated.
    if (iframe.current) iframe.current.src = src;
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [projectId, canEdit, src]);

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
      <iframe
        ref={iframe}
        title="Editor"
        className="min-h-0 w-full flex-1 border-0"
        allow="fullscreen; clipboard-read; clipboard-write"
      />
    </div>
  );
}
