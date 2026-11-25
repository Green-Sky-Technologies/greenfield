'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { updateFilesAction } from '@/server/actions/design-systems';
import type { LibraryChange } from '@/server/services/design-systems/update';
import { BuildProgress, useBuild } from '../build-progress';

interface Props {
  systemId: string;
  name: string;
  /** "github.com/owner/repo" when the system was built from a repository. */
  repo: string | null;
  version: { version: number; published: boolean };
  changes: { from: number | null; list: LibraryChange[] };
  files: { projectName: string; version: number }[];
  publishedVersion: number | null;
  can: { edit: boolean; publish: boolean };
}

const KIND = { colour: 'Colour', spacing: 'Scale', type: 'Type style', component: 'Component' };

/**
 * Story 10.6 on the review page: a new version (rebuilt from the repository, or uploaded), what
 * it changes against the published one, and updating the files that use the system.
 */
export function UpdatePanel({
  systemId,
  name,
  repo,
  version,
  changes,
  files,
  publishedVersion,
  can,
}: Props) {
  const router = useRouter();
  const build = useBuild();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const behind =
    publishedVersion === null ? [] : files.filter((f) => f.version !== publishedVersion);

  async function rebuild() {
    setMessage(null);
    const done = await build.run(() =>
      fetch(`/api/design-systems/${systemId}/rebuild`, { method: 'POST' }),
    );
    if (done) {
      setMessage({ ok: true, text: `Version ${done.version} is ready to review.` });
      router.refresh();
    }
  }

  async function upload(file: File) {
    setMessage(null);
    const res = await fetch(`/api/design-systems/${systemId}/versions`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as {
      version?: number;
      message?: string;
    } | null;
    if (res?.ok) {
      setMessage({ ok: true, text: `Version ${body?.version} is ready to review.` });
      router.refresh();
    } else setMessage({ ok: false, text: body?.message ?? 'Upload failed.' });
  }

  const update = () =>
    start(async () => {
      const res = await updateFilesAction(systemId);
      if (!res.ok) return setMessage({ ok: false, text: res.error });
      const { updated, skipped } = res.data;
      setMessage({
        ok: true,
        text: [
          `Updated ${updated.length} file${updated.length === 1 ? '' : 's'}.`,
          ...skipped.map((s) => `${s.projectName}: ${s.reason}, not updated.`),
        ].join(' '),
      });
      router.refresh();
    });

  return (
    <section
      aria-label="Versions and updates"
      className="mt-10 max-w-3xl border-t border-border pt-6"
    >
      <h2 className="type-label mb-3 text-muted">Versions and updates</h2>

      {changes.from !== null && (
        <div className="mb-6" aria-label="What changes">
          <p className="text-sm">
            v{version.version} against v{changes.from}:{' '}
            {changes.list.length
              ? `${changes.list.length} change${changes.list.length === 1 ? '' : 's'}`
              : 'no changes'}
          </p>
          <ul className="mt-2 border border-border text-sm">
            {changes.list.map((c) => (
              <li
                key={`${c.kind}:${c.name}`}
                data-testid="library-change"
                className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-0"
              >
                <span className="w-24 shrink-0 font-mono text-xs text-muted">{KIND[c.kind]}</span>
                <span className="font-mono text-xs">{c.name}</span>
                <span className="ml-auto flex items-center gap-2 font-mono text-xs text-muted">
                  {c.change === 'changed' ? (
                    <>
                      {c.kind === 'colour' && <Swatch hex={c.from!} />}
                      {c.from} → {c.kind === 'colour' && <Swatch hex={c.to!} />}
                      {c.to}
                    </>
                  ) : (
                    c.change
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {can.edit && version.published && repo && (
          <button type="button" className="btn-ghost" disabled={build.running} onClick={rebuild}>
            {build.running ? 'Rebuilding…' : `Rebuild from ${repo}`}
          </button>
        )}
        {can.edit && version.published && (
          <label className="btn-ghost cursor-pointer">
            Upload a new version
            <input
              type="file"
              accept=".figcraft"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>
      {(build.running || build.error) && (
        <div className="mt-4 max-w-sm">
          <BuildProgress
            name={name}
            done={build.done}
            running={build.running}
            error={build.error}
          />
        </div>
      )}

      <div className="mt-6 text-sm" aria-label="Files">
        <p>
          Used in {files.length} file{files.length === 1 ? '' : 's'}
          {behind.length > 0 && publishedVersion !== null
            ? ` · ${behind.length} on an older version than v${publishedVersion}`
            : ''}
        </p>
        {behind.length > 0 && (
          <>
            <ul className="mt-2 text-xs text-muted">
              {behind.map((f) => (
                <li key={f.projectName}>
                  {f.projectName} · v{f.version} → v{publishedVersion}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn-primary mt-3"
              disabled={pending || !can.publish}
              title={can.publish ? undefined : 'Only admins can update files in this workspace'}
              onClick={update}
            >
              Update {behind.length} file{behind.length === 1 ? '' : 's'}
            </button>
          </>
        )}
      </div>
      {message && (
        <p
          role="status"
          aria-label="Update status"
          className={`mt-3 text-sm ${message.ok ? 'text-ok' : 'text-danger'}`}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}

function Swatch({ hex }: { hex: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 border border-border"
      style={{ background: hex }}
    />
  );
}
