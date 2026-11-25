'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function UploadForm({ base }: { base: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(form: FormData) {
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return setError('Choose a .figcraft file.');
    setPending(true);
    setError(null);
    const name = String(form.get('name') ?? '');
    const res = await fetch(`/api/design-systems?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (res?.ok && body?.id) return router.push(`${base}/${body.id}`);
    setPending(false);
    setError(body?.message ?? 'Upload failed. Please try again.');
  }

  return (
    <form action={submit} className="flex flex-col gap-5" aria-label="Upload a library file">
      <div>
        <label className="label" htmlFor="ds-name">
          Name
        </label>
        <input id="ds-name" name="name" className="input" required maxLength={120} />
      </div>
      <div>
        <label className="label" htmlFor="ds-file">
          Library file
        </label>
        <input
          id="ds-file"
          name="file"
          type="file"
          accept=".figcraft"
          required
          className="input file:mr-3 file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-text"
        />
        <p className="mt-1 text-xs text-muted">
          A FigCraft file with the system&apos;s colour variables, text styles and components. You
          review what to keep before anything is published.
        </p>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Uploading…' : 'Upload and review'}
        </button>
      </div>
    </form>
  );
}
