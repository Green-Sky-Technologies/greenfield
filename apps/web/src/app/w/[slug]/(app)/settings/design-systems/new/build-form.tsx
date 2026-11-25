'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BuildProgress, useBuild } from '../build-progress';

/**
 * Story 10.2: point Greenfield at a repository and uploads; it builds the library file and the
 * guide, then opens the review (10.3). Nothing is published until then.
 */
export function BuildForm({ base }: { base: string }) {
  const router = useRouter();
  const build = useBuild();
  const [name, setName] = useState('');
  const [repo, setRepo] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const started = build.running || Object.keys(build.done).length > 0 || !!build.error;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const form = new FormData();
    form.set('name', name);
    form.set('repo', repo);
    for (const f of files) form.append('files', f);
    const done = await build.run(() =>
      fetch('/api/design-systems/build', { method: 'POST', body: form }),
    );
    if (done) router.push(`${base}/${done.id}`);
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <form onSubmit={submit} className="flex flex-col gap-6" aria-label="Build from sources">
        <div>
          <label className="label" htmlFor="ds-build-name">
            Name
          </label>
          <input
            id="ds-build-name"
            className="input"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <p className="type-label mb-2 text-muted">Sources</p>
          <ul className="border border-border">
            <li className="flex items-start gap-4 border-b border-border p-4">
              <span aria-hidden className="mt-0.5 font-mono text-muted">
                ⌥
              </span>
              <div className="min-w-0 flex-1">
                <label className="text-sm font-medium" htmlFor="ds-repo">
                  GitHub repository
                </label>
                <input
                  id="ds-repo"
                  className="input mt-2"
                  placeholder="https://github.com/owner/repo"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted">
                  A public repository: its Tailwind config, CSS variables and React components.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-4 border-b border-border p-4">
              <span aria-hidden className="mt-0.5 font-mono text-muted">
                ▤
              </span>
              <div className="min-w-0 flex-1">
                <label className="text-sm font-medium" htmlFor="ds-uploads">
                  Uploads
                </label>
                <input
                  id="ds-uploads"
                  type="file"
                  multiple
                  accept=".css,.scss,.js,.cjs,.mjs,.ts,.tsx,.jsx,.json,.zip,.svg,.png,.jpg,.pdf"
                  className="input mt-2 file:mr-3 file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-text"
                  onChange={(e) => setFiles([...(e.target.files ?? [])])}
                />
                <p className="mt-1 text-xs text-muted">
                  Code (CSS, a Tailwind config, components, or a .zip of them) and SVG logos.
                  Screenshots and PDFs aren&apos;t read yet.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-4 p-4 text-muted">
              <span aria-hidden className="mt-0.5 font-mono">
                ◇
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Figma file</p>
                <p className="mt-1 text-xs">
                  Not yet: import the .fig in the editor, then upload the library file below.
                </p>
              </div>
              <span className="font-mono text-xs">Later</span>
            </li>
          </ul>
        </div>
        <p className="max-w-xl text-sm text-muted">
          Greenfield builds a library file (variables, styles, components) and a short guide Claude
          reads before every design. Nothing is published until you review it.
        </p>
        <div>
          <button
            type="submit"
            className="btn-primary"
            disabled={build.running || !name.trim() || (!repo.trim() && !files.length)}
          >
            {build.running ? 'Building…' : 'Build design system'}
          </button>
        </div>
      </form>
      {started && (
        <BuildProgress name={name} done={build.done} running={build.running} error={build.error} />
      )}
    </div>
  );
}
