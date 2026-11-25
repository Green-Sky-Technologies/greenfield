'use client';

/**
 * An instance's properties (Story 5.9): variants, booleans and text, set with
 * `instance.setProperties`; go to its main component, reset its overrides, or detach it. The
 * properties are read (`component.properties`) when the instance's fields change and after each
 * change from here; a change shows at once.
 */
import type { NodeFields } from '@greenfield/editor-state';
import { useEditorStore } from '@greenfield/editor-state/react';
import { useEffect, useState } from 'react';
import { Row, Section, Select, useRun } from './ui';

interface Property {
  name: string;
  type: 'variant' | 'boolean' | 'text' | 'instanceSwap' | string;
  value: unknown;
  options?: string[];
}

function useProperties(node: NodeFields) {
  const store = useEditorStore();
  const [list, setList] = useState<Property[] | null>(null);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let live = true;
    store
      .run('component.properties', { id: node.id })
      .then((r) => {
        const props = ((r as { properties?: Property[] } | null)?.properties ?? []).filter(
          (p) => typeof p.name === 'string',
        );
        if (live) setList(props);
      })
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [store, node, reads]);
  return {
    list,
    /** Show `value` now, and read the instance again once `write` has run. */
    change(name: string, value: unknown, write: Promise<void>) {
      setList((l) => l?.map((p) => (p.name === name ? { ...p, value } : p)) ?? l);
      write.finally(() => setReads((n) => n + 1));
    },
  };
}

/** The property's name without the `#id` suffix some files carry (`Label#12:3` → `Label`). */
const label = (name: string) => name.replace(/#[^#]*$/, '');

export function InstanceSection({ node }: { node: NodeFields }) {
  const { list: props, change } = useProperties(node);
  const { run, error } = useRun();
  const ids = [node.id];
  const set = (name: string, value: unknown) =>
    change(name, value, run('instance.setProperties', { ids, properties: { [name]: value } }));
  const main = typeof node.mainComponentName === 'string' ? node.mainComponentName : 'Component';

  return (
    <Section title="Instance">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-medium" title={main} data-testid="instance-main">
          {main}
        </span>
        <span className="flex shrink-0 gap-1">
          <button
            type="button"
            className="btn-link text-xs"
            onClick={() => run('component.goToMain', { id: node.id })}
          >
            Go to main
          </button>
          <button
            type="button"
            className="btn-link text-xs"
            onClick={() => run('component.resetInstance', { ids })}
          >
            Reset
          </button>
          <button
            type="button"
            className="btn-link text-xs"
            onClick={() => run('component.detach', { ids })}
          >
            Detach
          </button>
        </span>
      </div>
      {props === null && <p className="text-xs text-muted">Loading properties…</p>}
      {props?.map((p) => (
        <Row key={p.name} label={label(p.name)}>
          {p.type === 'boolean' ? (
            <input
              type="checkbox"
              aria-label={label(p.name)}
              checked={p.value === true}
              className="shell-focus size-4 accent-[var(--accent)]"
              onChange={(e) => set(p.name, e.target.checked)}
            />
          ) : p.type === 'text' ? (
            <TextProperty
              name={label(p.name)}
              value={String(p.value ?? '')}
              onCommit={(v) => set(p.name, v)}
            />
          ) : p.options?.length ? (
            <Select
              aria-label={label(p.name)}
              value={String(p.value)}
              onChange={(e) => set(p.name, e.target.value)}
            >
              {p.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          ) : (
            <span className="truncate text-muted">{String(p.value ?? '')}</span>
          )}
        </Row>
      ))}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </Section>
  );
}

function TextProperty({
  name,
  value,
  onCommit,
}: {
  name: string;
  value: string;
  onCommit(v: string): void;
}) {
  const [text, setText] = useState(value);
  const [was, setWas] = useState(value);
  if (was !== value) {
    setWas(value);
    setText(value);
  }
  const commit = () => text !== value && onCommit(text);
  return (
    <input
      aria-label={name}
      value={text}
      className="h-7 min-w-0 flex-1 bg-surface-2 px-2 text-xs outline-none focus:ring-1 focus:ring-[var(--focus)]"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}
