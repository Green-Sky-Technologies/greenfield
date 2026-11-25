'use client';

import { useState, useTransition } from 'react';
import {
  publishAction,
  setDefaultAction,
  setPolicyAction,
  unpublishAction,
} from '@/server/actions/design-systems';
import type { ActionResult } from '@/server/actions/result';

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const res = await fn();
      setError(res.ok ? null : res.error);
    });
  return { error, pending, act };
}

/** The Published / Draft switch and "Make default", for those allowed. */
export function SystemRowActions({
  system,
  can,
}: {
  system: { id: string; name: string; published: boolean; isDefault: boolean };
  can: { publish: boolean; setDefault: boolean };
}) {
  const { error, pending, act } = useAction();
  const locked = !can.publish || pending || system.isDefault;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={system.published}
          aria-label={`Published: ${system.name}`}
          title={system.isDefault ? 'The default stays published' : undefined}
          disabled={locked}
          onClick={() =>
            act(() => (system.published ? unpublishAction(system.id) : publishAction(system.id)))
          }
          className={`shell-focus flex h-4 w-7 items-center border p-0.5 disabled:cursor-not-allowed ${
            system.published ? 'justify-end border-accent bg-accent' : 'border-border bg-surface-2'
          }`}
        >
          <span className={`h-full w-2.5 ${system.published ? 'bg-bg' : 'bg-muted'}`} />
        </button>
        <span>{system.published ? 'Published' : 'Draft'}</span>
        {system.published && !system.isDefault && can.setDefault && (
          <button
            type="button"
            className="btn-link text-xs text-muted"
            disabled={pending}
            onClick={() => act(() => setDefaultAction(system.id))}
          >
            Make default
          </button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

const CHOICES = [
  {
    value: 'admins',
    label: 'Admins only',
    hint: 'Only Admins can publish, set the default and delete.',
  },
  {
    value: 'admins_and_editors',
    label: 'Admins and Editors',
    hint: 'Editors can publish, set the default and delete too.',
  },
] as const;

/** "Who can manage": admins change it; everyone else sees it. */
export function PolicyForm({ managers, canChange }: { managers: string; canChange: boolean }) {
  const { error, pending, act } = useAction();
  return (
    <fieldset className="mt-8 flex max-w-xl flex-col gap-1" disabled={!canChange || pending}>
      <legend className="type-label mb-2 text-muted">Who can manage</legend>
      {CHOICES.map((c) => (
        <label key={c.value} className="flex cursor-pointer items-start gap-2.5 py-2 text-sm">
          <input
            type="radio"
            name="managers"
            value={c.value}
            checked={managers === c.value}
            onChange={() => act(() => setPolicyAction(c.value))}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            {c.label}
            <span className="mt-0.5 block text-xs text-muted">{c.hint}</span>
          </span>
        </label>
      ))}
      {error && <p className="text-xs text-danger">{error}</p>}
    </fieldset>
  );
}
