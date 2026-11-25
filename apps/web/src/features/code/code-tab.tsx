'use client';

/**
 * The Code tab (Story 5.12): FigCraft's generated code for the selected layer (`inspect.code`,
 * the generator Story 7.2 evaluates), in the language you pick, with copy. It regenerates when
 * the selection, the language or the document changes, and only while the tab is on screen.
 */
import type { CommandParams, NodeId } from '@greenfield/bridge';
import { useDocument, useEditorStore, useNode, useSelection } from '@greenfield/editor-state/react';
import { useEffect, useRef, useState, type RefObject } from 'react';

type Language = NonNullable<CommandParams<'inspect.code'>['language']>;

const LANGUAGES: Record<Language, string> = {
  react: 'React',
  tailwind: 'React + Tailwind',
  css: 'CSS',
  html: 'HTML',
  vue: 'Vue',
  leptos: 'Leptos',
  swiftui: 'SwiftUI',
  compose: 'Jetpack Compose',
  flutter: 'Flutter',
  arkui: 'ArkUI',
};

interface Generated {
  id: NodeId;
  language: Language;
  code?: string;
  /** From the component's Code Connect snippet rather than generated. */
  connected?: boolean;
  error?: string;
}

/** Whether `ref` is on screen (a hidden tab or panel is not). */
function useShown(ref: RefObject<Element | null>): boolean {
  // Without IntersectionObserver (tests' DOMs), always.
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setShown(!!e?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return shown;
}

/**
 * The code for `id` in `language`, read again on each `revision` while `shown`. One read in
 * flight; requests during it collapse into one more after it (a drag changes the document every
 * frame).
 */
function useGeneratedCode(
  id: NodeId | undefined,
  language: Language,
  revision: number | undefined,
  shown: boolean,
): Generated | null {
  const store = useEditorStore();
  const [result, setResult] = useState<Generated | null>(null);
  const busy = useRef(false);
  const next = useRef<{ id: NodeId; language: Language } | null>(null);

  useEffect(() => {
    if (!shown || id == null) return;
    next.current = { id, language };
    if (busy.current) return;
    busy.current = true;
    void (async () => {
      for (let req = next.current; req; req = next.current) {
        next.current = null;
        try {
          const r = (await store.run('inspect.code', req)) as { code: string; connected: boolean };
          setResult({ ...req, code: r.code, connected: r.connected });
        } catch (e) {
          setResult({ ...req, error: e instanceof Error ? e.message : String(e) });
        }
      }
      busy.current = false;
    })();
  }, [store, id, language, revision, shown]);

  return result && result.id === id && result.language === language ? result : null;
}

export function CodeTab() {
  const selection = useSelection();
  const id = selection.length === 1 ? selection[0] : undefined;
  const node = useNode(id);
  const revision = useDocument()?.revision;
  const [language, setLanguage] = useState<Language>('react');
  const ref = useRef<HTMLElement>(null);
  const shown = useShown(ref);
  const generated = useGeneratedCode(id, language, revision, shown);
  const [copied, setCopied] = useState<'Copied' | 'Copy failed' | null>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = () => {
    if (!generated?.code) return;
    navigator.clipboard.writeText(generated.code).then(
      () => setCopied('Copied'),
      () => setCopied('Copy failed'),
    );
  };

  return (
    <section
      ref={ref}
      aria-label="Code"
      data-testid="code-tab"
      className="flex min-h-0 flex-1 flex-col text-xs"
    >
      <div className="flex items-baseline justify-between border-b border-border px-4 py-3.5">
        <span className="text-[13px] font-semibold">
          {selection.length === 0
            ? 'Nothing selected'
            : selection.length > 1
              ? `${selection.length} layers`
              : (node?.name ?? '…')}
        </span>
        {generated?.connected && <span className="type-label text-muted">Code Connect</span>}
      </div>
      {id == null ? (
        <p className="px-4 py-3.5 text-muted">
          {selection.length > 1
            ? 'Select one layer to see its code.'
            : 'Select a layer to see its code.'}
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 px-4 py-2.5">
            <select
              aria-label="Language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              className="shell-focus bg-transparent text-text outline-none"
            >
              {Object.entries(LANGUAGES).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={copy}
              disabled={!generated?.code}
              className="shell-focus h-[26px] px-3 shadow-[inset_0_0_0_1px_var(--border)] disabled:opacity-50"
            >
              {copied ?? 'Copy'}
            </button>
          </div>
          {generated?.error ? (
            <p role="alert" className="px-4 py-2 text-danger">
              {generated.error}
            </p>
          ) : (
            <pre
              aria-label="Generated code"
              aria-busy={!generated}
              className="mx-4 mb-4 min-h-0 flex-1 overflow-auto bg-surface-2 p-3 font-mono text-[11px] leading-relaxed"
            >
              <code>{generated?.code ?? 'Generating…'}</code>
            </pre>
          )}
        </>
      )}
    </section>
  );
}
