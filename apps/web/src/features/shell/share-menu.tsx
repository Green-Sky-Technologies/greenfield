'use client';

/**
 * Share (Story 5.1). Everyone in the workspace can copy the project's address. Editors and admins
 * (`share:manage`) can also create a share link through the existing `/api/share` flow; the
 * server checks the permission again. A share link shows a placeholder until read-only viewing
 * lands (Story 3.5).
 */
import { useState } from 'react';

interface Props {
  projectId: string;
  canShare: boolean;
  open: boolean;
  onToggle: () => void;
}

export function ShareMenu({ projectId, canShare, open, onToggle }: Props) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="shell-focus h-8 bg-user px-3.5 text-sm font-medium text-user-ink hover:brightness-110"
      >
        Share
      </button>
      {open && <SharePanel projectId={projectId} canShare={canShare} />}
    </div>
  );
}

function SharePanel({ projectId, canShare }: { projectId: string; canShare: boolean }) {
  const [copied, setCopied] = useState<'project' | 'link' | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = async (text: string, what: 'project' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setError('Couldn’t copy. Select the link and copy it yourself.');
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      if (!r.ok) throw new Error(`Couldn’t create a link (${r.status}). Try again.`);
      const { path } = (await r.json()) as { path: string };
      setLink(new URL(path, window.location.origin).href);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Share"
      className="absolute top-full right-0 z-30 mt-1 w-80 border border-border bg-surface text-sm shadow-[0_8px_24px_-12px_rgb(7_54_66/0.35)]"
    >
      <section className="border-b border-border p-3">
        <h2 className="font-medium text-text">Project link</h2>
        <p className="mt-0.5 text-xs text-muted">Members of this workspace can open it.</p>
        <button
          type="button"
          className="shell-focus mt-2 h-8 w-full border border-border px-3 hover:bg-surface-2"
          onClick={() => copy(window.location.href.split('?')[0]!, 'project')}
        >
          {copied === 'project' ? 'Copied' : 'Copy project link'}
        </button>
      </section>
      <section className="p-3">
        <h2 className="font-medium text-text">Share link</h2>
        {canShare ? (
          link ? (
            <>
              <label htmlFor="share-link" className="sr-only">
                Share link
              </label>
              <input
                id="share-link"
                readOnly
                value={link}
                className="input mt-2 font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                className="shell-focus mt-2 h-8 w-full bg-user px-3 font-medium text-user-ink hover:brightness-110"
                onClick={() => copy(link, 'link')}
              >
                {copied === 'link' ? 'Copied' : 'Copy share link'}
              </button>
            </>
          ) : (
            <>
              <p className="mt-0.5 text-xs text-muted">
                Workspace members with the link can view. It shows a placeholder until read-only
                viewing is ready.
              </p>
              <button
                type="button"
                className="shell-focus mt-2 h-8 w-full border border-border px-3 hover:bg-surface-2 disabled:opacity-50"
                onClick={create}
                disabled={busy}
              >
                {busy ? 'Creating…' : 'Create share link'}
              </button>
            </>
          )
        ) : (
          <p className="mt-0.5 text-xs text-muted">
            Only editors and admins can create share links.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
