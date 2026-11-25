'use client';

import type { DesignSystemItem } from '@greenfield/db';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  deleteDesignSystemAction,
  publishAction,
  saveReviewAction,
  setDefaultAction,
} from '@/server/actions/design-systems';
import type { ActionResult } from '@/server/actions/result';

interface Props {
  base: string;
  system: { id: string; name: string; isDefault: boolean; published: boolean };
  version: {
    version: number;
    published: boolean;
    items: DesignSystemItem[];
    dropped: string[];
    guide: string;
  };
  can: { edit: boolean; publish: boolean; setDefault: boolean };
}

const SECTIONS = [
  { kind: 'colours', title: 'Colours' },
  { kind: 'spacing', title: 'Spacing and scales' },
  { kind: 'type', title: 'Type styles' },
  { kind: 'component', title: 'Components' },
] as const;

export function ReviewForm({ base, system, version, can }: Props) {
  const router = useRouter();
  const [dropped, setDropped] = useState(() => new Set(version.dropped));
  const [guide, setGuide] = useState(version.guide);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const editable = can.edit && !version.published;

  const act = (fn: () => Promise<ActionResult>, done: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setMessage(res.ok ? { ok: true, text: done } : { ok: false, text: res.error });
      if (res.ok) after?.();
    });
  const review = () => ({ dropped: [...dropped], guide });
  const toggle = (key: string, drop: boolean) =>
    setDropped((prev) => {
      const next = new Set(prev);
      if (drop) next.add(key);
      else next.delete(key);
      return next;
    });

  const kept = version.items.length - dropped.size;
  return (
    <main className="w-full">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <h1 className="font-wordmark text-4xl">Review · {system.name}</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted" aria-live="polite">
            {kept} kept · {dropped.size} dropped
          </span>
          {version.published ? (
            <>
              <span className="type-label text-muted">
                v{version.version} · {system.published ? 'published' : 'unpublished'}
              </span>
              {system.isDefault ? (
                <>
                  <span className="bg-accent px-1.5 font-mono text-xs text-accent-ink">
                    Default
                  </span>
                  {can.setDefault && (
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={pending}
                      onClick={() =>
                        act(() => setDefaultAction(null), 'New files start blank again.')
                      }
                    >
                      Stop using as default
                    </button>
                  )}
                </>
              ) : (
                <>
                  {can.setDefault && system.published && (
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={pending}
                      onClick={() => act(() => setDefaultAction(system.id), 'Now the default.')}
                    >
                      Make default
                    </button>
                  )}
                  {can.publish && (
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={pending}
                      onClick={() =>
                        confirm(`Delete ${system.name}? Files that use it keep what they have.`) &&
                        act(
                          () => deleteDesignSystemAction(system.id),
                          'Deleted.',
                          () => router.push(base),
                        )
                      }
                    >
                      Delete
                    </button>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              {can.edit && (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={pending}
                  onClick={() => act(() => saveReviewAction(system.id, review()), 'Draft saved.')}
                >
                  Save draft
                </button>
              )}
              <button
                type="button"
                className="btn-primary"
                disabled={pending || !can.publish || kept === 0}
                title={can.publish ? undefined : 'Only admins can publish in this workspace'}
                onClick={() => act(() => publishAction(system.id, review()), 'Published.')}
              >
                Publish
              </button>
            </>
          )}
        </div>
      </div>
      {message && (
        <p role="status" className={`mb-2 text-sm ${message.ok ? 'text-ok' : 'text-danger'}`}>
          {message.text}
        </p>
      )}

      {SECTIONS.map(({ kind, title }) => {
        const items = version.items.filter((i) => i.kind === kind);
        if (!items.length) return null;
        return (
          <section key={kind} aria-label={title} className="mt-6">
            <h2 className="type-label mb-1 text-muted">{title}</h2>
            {items.map((item) => (
              <ItemRow
                key={item.key}
                item={item}
                dropped={dropped.has(item.key)}
                editable={editable}
                onChange={(drop) => toggle(item.key, drop)}
              />
            ))}
          </section>
        );
      })}

      <section className="mt-8 max-w-3xl">
        <label className="type-label mb-2 block text-muted" htmlFor="ds-guide">
          Guide for Claude
        </label>
        <textarea
          id="ds-guide"
          className="input min-h-40 font-mono"
          value={guide}
          readOnly={!editable}
          onChange={(e) => setGuide(e.target.value)}
          placeholder="How to use this system: when to use each colour, which type style for what, which components to reach for."
        />
      </section>
    </main>
  );
}

function ItemRow({
  item,
  dropped,
  editable,
  onChange,
}: {
  item: DesignSystemItem;
  dropped: boolean;
  editable: boolean;
  onChange: (drop: boolean) => void;
}) {
  return (
    <div
      data-testid="review-item"
      data-dropped={dropped}
      aria-label={item.name}
      className={`grid grid-cols-[12rem_1fr_auto] items-start gap-6 border-b border-border py-5 ${dropped ? 'opacity-50' : ''}`}
    >
      <div>
        <p className="text-sm font-medium">{item.name}</p>
        <p className="mt-1 text-xs text-muted">{meta(item)}</p>
      </div>
      <Preview item={item} />
      <div className="flex gap-2">
        <button
          type="button"
          aria-pressed={!dropped}
          disabled={!editable}
          onClick={() => onChange(false)}
          className={!dropped ? 'btn-primary' : 'btn-ghost'}
        >
          ✓ Keep
        </button>
        <button
          type="button"
          aria-pressed={dropped}
          disabled={!editable}
          onClick={() => onChange(true)}
          className={dropped ? 'btn bg-surface-2 text-text' : 'btn-ghost'}
        >
          ✕ Drop
        </button>
      </div>
    </div>
  );
}

function meta(item: DesignSystemItem): string {
  switch (item.kind) {
    case 'colours':
      return `${item.colours.length} value${item.colours.length === 1 ? '' : 's'}`;
    case 'spacing':
      return `${item.values.length} step${item.values.length === 1 ? '' : 's'}`;
    case 'type':
      return `${item.fontFamily} ${item.fontStyle} · ${item.fontSize}`;
    case 'component':
      return item.variants > 1 ? `${item.variants} variants` : 'Component';
  }
}

function Preview({ item }: { item: DesignSystemItem }) {
  switch (item.kind) {
    case 'colours':
      return (
        <ul className="flex flex-wrap gap-2">
          {item.colours.map((c) => (
            <li key={c.name} className="w-20">
              <span
                className="block h-11 border border-border"
                style={{ background: c.hex ?? 'transparent' }}
              />
              <span className="mt-1 block truncate font-mono text-[11px] text-muted">{c.name}</span>
            </li>
          ))}
        </ul>
      );
    case 'spacing':
      return (
        <ul className="flex flex-wrap items-end gap-3">
          {item.values.map((v) => (
            <li key={v.name} className="flex flex-col items-start gap-1">
              <span
                className="block h-3 bg-muted"
                style={{ width: Math.min(Math.max(v.value, 2), 160) }}
              />
              <span className="font-mono text-[11px] text-muted">
                {v.name} · {v.value}
              </span>
            </li>
          ))}
        </ul>
      );
    case 'type':
      return (
        <p
          className="truncate"
          style={{
            fontFamily: `"${item.fontFamily}", var(--font-sans)`,
            fontSize: Math.min(Math.max(item.fontSize, 11), 48),
          }}
        >
          The quick brown fox
        </p>
      );
    case 'component':
      return (
        <span className="flex h-16 w-36 items-center justify-center border border-border bg-surface font-mono text-xs text-muted">
          {item.name}
        </span>
      );
  }
}
