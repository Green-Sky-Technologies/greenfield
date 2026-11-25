/**
 * Browser side of the project's design file (Story 3.1): load it, hold the edit lock, save it.
 *
 * - Load: GET /api/projects/:id/file (204 when nothing is saved yet; the name comes either way).
 * - Lock: the tab acquires the project's edit lock and heartbeats it; saves carry the tab's
 *   session id and the server refuses them (409) once the lock is stale. A lost lock is never
 *   re-acquired silently: that would save over someone else's newer document.
 * - Save: with Blob, upload straight to private Blob (`@vercel/blob/client`, token from
 *   ./file/upload) and then commit the key (POST ./file). With the local fallback, PUT the bytes.
 *
 * Bytes are never logged.
 */

/** services/locks HEARTBEAT_MS (that module is server-only). */
const HEARTBEAT_MS = 20_000;
/** Above this, Blob uploads go in parts (each part is at least 5 MB). */
const MULTIPART_BYTES = 8 * 1024 * 1024;

export type Storage = 'vercel-blob' | 'local-fs';

export class SaveError extends Error {
  override name = 'SaveError';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function failure(r: Response, what: string): Promise<SaveError> {
  const body = (await r.json().catch(() => null)) as { message?: string } | null;
  return new SaveError(body?.message ?? `${what} failed (${r.status})`, r.status);
}

export interface LoadedFile {
  name: string;
  /** Null when nothing has been saved yet. */
  bytes: ArrayBuffer | null;
  storage: Storage;
}

export function designFileClient(projectId: string, sessionId: string) {
  const api = `/api/projects/${encodeURIComponent(projectId)}/file`;
  let storage: Storage = 'local-fs';
  let prefix = '';

  return {
    async load(): Promise<LoadedFile> {
      const r = await fetch(api, { cache: 'no-store' });
      if (r.status !== 200 && r.status !== 204) throw await failure(r, 'Load');
      storage = r.headers.get('x-storage') === 'vercel-blob' ? 'vercel-blob' : 'local-fs';
      prefix = r.headers.get('x-upload-prefix') ?? '';
      const name = decodeURIComponent(r.headers.get('x-file-name') ?? 'Untitled.figcraft');
      return { name, bytes: r.status === 204 ? null : await r.arrayBuffer(), storage };
    },

    async save(bytes: Uint8Array): Promise<{ size: number; storage: Storage }> {
      // A copy: the editor's buffer may be transferred or reused.
      const body = new Blob([bytes.slice()], { type: 'application/octet-stream' });
      let r: Response;
      if (storage === 'vercel-blob') {
        const { upload } = await import('@vercel/blob/client');
        const key = `${prefix}${crypto.randomUUID()}.figcraft`;
        try {
          await upload(key, body, {
            access: 'private',
            handleUploadUrl: `${api}/upload`,
            clientPayload: JSON.stringify({ sessionId }),
            contentType: 'application/octet-stream',
            multipart: bytes.byteLength > MULTIPART_BYTES,
          });
        } catch (e) {
          // The token route's refusal (409 stale lock, 403) surfaces here as a BlobError.
          throw new SaveError(e instanceof Error ? e.message : 'Upload failed', 0);
        }
        r = await fetch(api, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key, sessionId }),
        });
      } else {
        r = await fetch(api, {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream', 'x-session-id': sessionId },
          body,
        });
      }
      if (!r.ok) throw await failure(r, 'Save');
      return (await r.json()) as { size: number; storage: Storage };
    },
  };
}

export type LockStatus = 'held' | 'held-by-other' | 'lost' | 'error';

/** Releases waiting to run, by session: a remount of the same editor cancels its own. */
const pendingRelease = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Acquire the project's edit lock for this tab and keep it alive. `onChange` reports whether
 * this tab can save. Returns a stop function that releases the lock shortly after, unless the
 * same session holds it again first (React remounts an effect in development); closing the tab
 * releases it at once. Keep `sessionId` stable for the editor's lifetime.
 */
export function holdEditLock(
  projectId: string,
  sessionId: string,
  onChange: (s: LockStatus) => void,
): () => void {
  const api = `/api/projects/${encodeURIComponent(projectId)}/lock`;
  const send = (method: string) =>
    fetch(api, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  clearTimeout(pendingRelease.get(sessionId));
  pendingRelease.delete(sessionId);

  type State = { lock: null | { isThisSession: boolean } };
  const report = (state: State) => {
    if (!stopped) onChange(state.lock?.isThisSession ? 'held' : 'lost');
  };

  send('POST')
    .then(async (r) => {
      if (stopped) return;
      if (!r.ok) return onChange('error');
      const { acquired } = (await r.json()) as { acquired: boolean };
      if (!acquired) return onChange('held-by-other');
      onChange('held');
      timer = setInterval(() => {
        send('PUT')
          .then((h) => (h.ok ? h.json().then(report) : undefined))
          .catch(() => {}); // offline: the next beat retries; the server decides on save
      }, HEARTBEAT_MS);
    })
    .catch(() => onChange('error'));

  const session = encodeURIComponent(sessionId);
  const release = () =>
    fetch(`${api}?sessionId=${session}&leave=1`, { method: 'DELETE', keepalive: true }).catch(
      () => {},
    );
  // A beacon outlives the page; WebKit drops a keepalive DELETE sent while it unloads.
  const leave = () => navigator.sendBeacon(`${api}/release?sessionId=${session}`);
  window.addEventListener('pagehide', leave);
  return () => {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener('pagehide', leave);
    pendingRelease.set(
      sessionId,
      setTimeout(() => {
        pendingRelease.delete(sessionId);
        void release();
      }, 1000),
    );
  };
}
