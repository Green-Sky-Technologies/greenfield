'use client';

/**
 * The inspector's controls: sections, number fields that scrub, selects and segmented buttons.
 * Every write goes through the store: a typed value or a click is one command or one batch (one
 * undo step); a scrub is a gesture (`useGesture`): one undo step, and Esc puts the value back.
 */
import type { BatchStep, CommandId, CommandParams } from '@greenfield/bridge';
import type { PreviewCommand } from '@greenfield/editor-state';
import { useEditorStore, useGesture } from '@greenfield/editor-state/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { sinceText, type ClaudeChange } from './agent-changes';
import { MIXED, measure, measureValue, round, type Measure, type Shared } from './fields';

/** One command, typed by its id. */
export const cmd = <C extends CommandId>(command: C, params: CommandParams<C>): PreviewCommand =>
  ({ command, params }) as PreviewCommand;

/** Where the inspector reports a write the editor refused. */
export const ReportContext = createContext<(error: string | null) => void>(() => {});

export const errorText = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error: /, '');

/** Run commands as one undo step (`label`), reporting a refusal. */
export function useApply() {
  const store = useEditorStore();
  const report = useContext(ReportContext);
  return useCallback(
    (commands: readonly PreviewCommand[], label: string) => {
      if (!commands.length) return;
      const [only] = commands;
      const done =
        commands.length === 1
          ? store.run(only!.command, only!.params)
          : store.batch(commands as unknown as BatchStep[], { label });
      done.then(
        () => report(null),
        (e: unknown) => report(errorText(e)),
      );
    },
    [store, report],
  );
}

const MARK = 'shadow-[inset_2px_0_0_var(--ember)]';
const BOX = 'flex h-7 min-w-0 items-center gap-2 bg-surface-2 px-2 font-mono text-xs';

export function Section({
  title,
  actions,
  children,
  testId,
}: {
  title: string;
  actions?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className="flex flex-col gap-2.5 border-b border-border px-4 py-3.5"
    >
      <div className="flex h-4 items-center justify-between">
        <h3 className="type-label text-muted">{title}</h3>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  pressed,
}: {
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="shell-focus flex size-6 items-center justify-center text-muted hover:bg-surface-2 hover:text-text"
    >
      {children}
    </button>
  );
}

export const Row = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-2 gap-2">{children}</div>
);

interface NumberFieldProps {
  /** The short label shown in the field, which is also the scrub handle (`X`, `Gap`). */
  label: string;
  /** The accessible name (`X position`). */
  name: string;
  /** A number, a measure (`"150%"`, `"Auto"`), MIXED for differing layers, or undefined. */
  value: Shared<unknown> | undefined;
  /** The commands that set `v` (a number, or a measure as `node.set` takes it). */
  set: (v: number | string) => PreviewCommand[];
  /** The undo step's label. */
  undo: string;
  step?: number;
  min?: number;
  max?: number;
  /** Where a scrub starts when the value has no number (Auto, mixed). */
  from?: Measure;
  /** The field accepts a percentage or `auto` as well as a number. */
  measured?: boolean;
  /** Claude set this value in the last turn. */
  changed?: boolean;
  testId?: string;
}

/**
 * A number field: type a value (Enter or leaving the field applies it, Esc drops it), arrow keys
 * step it (Shift: ×10), and dragging the label scrubs it as one gesture (Shift: ×10; Esc cancels).
 */
export function NumberField({
  label,
  name,
  value,
  set,
  undo,
  step = 1,
  min = -Infinity,
  max = Infinity,
  from,
  measured,
  changed,
  testId,
}: NumberFieldProps) {
  const apply = useApply();
  const report = useContext(ReportContext);
  const gesture = useGesture(undo);
  const current = value === MIXED ? null : measure(value);
  const shown =
    value === MIXED
      ? ''
      : current
        ? `${round(current.value)}${current.unit}`
        : typeof value === 'string'
          ? value
          : '';
  const draft = useRef<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState<string | null>(null);
  const scrub = useRef<{ x: number; start: Measure; last: number; moved: boolean } | null>(null);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const setDraft = (t: string | null) => {
    draft.current = t;
    setText(t);
  };

  const commitText = (t: string) => {
    const s = t.trim();
    if (!s || s === shown) return;
    if (measured && /^auto$/i.test(s)) return apply(set('auto'), undo);
    const m = measure(s);
    if (!m) return report(`${name}: "${s}" is not a number`);
    const unit = measured ? m.unit : '';
    apply(set(measureValue({ value: clamp(m.value), unit })), undo);
  };

  const stepBy = (by: number) => {
    const base = current ?? from ?? { value: 0, unit: '' };
    const next = { value: round(clamp(base.value + by)), unit: base.unit };
    apply(set(measureValue(next)), undo);
    setDraft(null);
  };

  // Esc while scrubbing: back to where the scrub began (before the shell sees the key).
  useEffect(() => {
    if (scrubbing === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      scrub.current = null;
      setScrubbing(null);
      gesture.cancel().catch((err: unknown) => report(errorText(err)));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [scrubbing, gesture, report]);

  const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = current ?? from ?? { value: 0, unit: '' };
    scrub.current = { x: e.clientX, start, last: start.value, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const s = scrub.current;
    if (!s) return;
    const v = round(
      clamp(s.start.value + Math.round(e.clientX - s.x) * step * (e.shiftKey ? 10 : 1)),
    );
    if (v === s.last) return;
    s.last = v;
    s.moved = true;
    const next = { value: v, unit: s.start.unit };
    gesture.preview(set(measureValue(next)));
    setScrubbing(`${v}${next.unit}`);
  };
  const onPointerUp = () => {
    const s = scrub.current;
    scrub.current = null;
    setScrubbing(null);
    if (s?.moved)
      gesture.commit().then(
        () => report(null),
        (err: unknown) => report(errorText(err)),
      );
  };

  return (
    <label className={`${BOX} ${changed ? MARK : ''}`} data-changed={changed || undefined}>
      <span
        aria-hidden
        className="shrink-0 cursor-ew-resize touch-none text-muted select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-testid={testId ? `${testId}-scrub` : undefined}
      >
        {label}
      </span>
      <input
        aria-label={name}
        data-testid={testId}
        className="w-full min-w-0 bg-transparent text-text outline-none placeholder:text-muted"
        inputMode={measured ? 'text' : 'decimal'}
        placeholder={value === MIXED ? 'Mixed' : value === undefined ? '–' : ''}
        value={scrubbing ?? text ?? shown}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={() => {
          const t = draft.current;
          setDraft(null);
          if (t !== null) commitText(t);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const t = draft.current;
            setDraft(null); // the field shows the layer's value once the editor reports it
            if (t !== null) commitText(t);
          } else if (e.key === 'Escape') {
            setDraft(null); // dropped; the shell gives the canvas focus
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            stepBy((e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1));
          }
        }}
      />
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
  changed,
  testId,
}: {
  label?: string;
  name: string;
  value: Shared<T>;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  changed?: boolean;
  testId?: string;
}) {
  const known = value === MIXED || options.some(([v]) => v === value);
  return (
    <label className={`${BOX} ${changed ? MARK : ''}`} data-changed={changed || undefined}>
      {label && <span className="shrink-0 text-muted">{label}</span>}
      <select
        aria-label={name}
        data-testid={testId}
        className="w-full min-w-0 cursor-pointer bg-transparent text-text outline-none"
        value={value === MIXED ? '' : value}
        onChange={(e) => onChange(e.currentTarget.value as T)}
      >
        {value === MIXED && (
          <option value="" disabled>
            Mixed
          </option>
        )}
        {!known && <option value={value}>{value}</option>}
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A row of buttons, one of them on (direction, text alignment). */
export function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
  changed,
}: {
  name: string;
  value: Shared<T>;
  options: readonly (readonly [T, string, ReactNode])[];
  onChange: (v: T) => void;
  changed?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={name}
      className={`flex h-7 bg-surface-2 ${changed ? MARK : ''}`}
      data-changed={changed || undefined}
    >
      {options.map(([v, text, icon]) => (
        <button
          key={v}
          type="button"
          aria-label={text}
          title={text}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`shell-focus flex flex-1 items-center justify-center text-xs ${
            value === v
              ? 'bg-surface text-text shadow-[inset_0_0_0_1px_var(--rule)]'
              : 'text-muted hover:text-text'
          }`}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

/**
 * "Fill changed by Claude, just now · Revert" under a section whose values Claude set in the last
 * turn. Revert writes the old values back as one undo step.
 */
export function ClaudeNote({
  what,
  changes,
  at,
}: {
  what: string;
  changes: readonly ClaudeChange[];
  at: string;
}) {
  const apply = useApply();
  if (!changes.length) return null;
  const revert = () => {
    const byLayer = new Map<number, Record<string, unknown>>();
    for (const c of changes)
      byLayer.set(c.id, { ...byLayer.get(c.id), [c.field]: c.before ?? null });
    apply(
      [...byLayer].map(([id, props]) => cmd('node.set', { id, props })),
      `Revert Claude's ${what.toLowerCase()}`,
    );
  };
  return (
    <p
      className="flex items-baseline justify-between gap-2 text-[11px] text-muted"
      data-testid="changed-by-claude"
    >
      <span>
        <span className="text-ember">{what}</span> changed by Claude, {sinceText(at)}
      </span>
      <button
        type="button"
        className="btn-link text-accent"
        onClick={revert}
        aria-label={`Revert ${what.toLowerCase()} to before Claude's change`}
      >
        Revert
      </button>
    </p>
  );
}
