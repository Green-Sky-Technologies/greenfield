'use client';

/**
 * The colour picker (Story 5.11, design 01-canvas-mode/5.11): the file's colour variables, a
 * custom colour (saturation/brightness square, hue strip, hex, opacity, the browser's eyedropper
 * where it has one) and its colour styles. A drag previews and commits once at the end; picking a
 * variable or style binds it, and Detach goes back to the colour it shows.
 */
import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { formatOpacity, hexToHsv, hsvToHex, normalizeHex, parseOpacity, type Hsv } from './colour';
import { displayName, useLibrary, type Library } from './library';
import type { Anchor, ColourValue } from './open';
import { Popover, SearchField } from './popover';

type Tab = 'variables' | 'custom' | 'styles';
const TABS: { id: Tab; label: string }[] = [
  { id: 'variables', label: 'Variables' },
  { id: 'custom', label: 'Custom' },
  { id: 'styles', label: 'Styles' },
];

export interface ColourPickerProps {
  anchor: Anchor;
  value: ColourValue;
  onPreview(value: ColourValue): void;
  onCommit(value: ColourValue): void;
  onClose(): void;
}

/** What a value shows as: its hex and opacity, and the variable or style it is bound to. */
export function resolveColour(
  value: ColourValue,
  library: Library,
): { hex: string; opacity: number; bound: string | null } {
  if ('hex' in value) return { hex: value.hex, opacity: value.opacity, bound: null };
  if ('variable' in value) {
    const v = library.variables.find((x) => x.id === value.variable);
    return { hex: normalizeHex(v?.display ?? '') ?? '#000000', opacity: 1, bound: v?.name ?? null };
  }
  const s = library.styles.find((x) => x.id === value.style);
  return { hex: s?.hex ?? '#000000', opacity: 1, bound: s?.name ?? null };
}

export function ColourPicker({ anchor, value, onPreview, onCommit, onClose }: ColourPickerProps) {
  const library = useLibrary('open');
  const [current, setCurrent] = useState(value);
  const [tab, setTab] = useState<Tab>(
    'variable' in value ? 'variables' : 'style' in value ? 'styles' : 'custom',
  );
  const [query, setQuery] = useState('');
  const shown = resolveColour(current, library);
  // A drag's pointer events can outlive the picker (Esc mid-drag): nothing reaches the opener
  // after it closed.
  const closed = useRef(false);
  const close = () => {
    closed.current = true;
    onClose();
  };
  const preview = (v: ColourValue) => closed.current || onPreview(v);
  const commit = (v: ColourValue) => {
    if (closed.current) return;
    setCurrent(v);
    onCommit(v);
  };

  return (
    <Popover anchor={anchor} label="Colour" testId="colour-picker" width={286} onClose={close}>
      <div role="tablist" aria-label="Colour source" className="flex gap-4 text-xs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`shell-focus pb-1 ${tab === t.id ? 'font-semibold shadow-[inset_0_-2px_0_var(--text)]' : 'text-muted hover:text-text'}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'custom' ? (
        <CustomColour
          hex={shown.hex}
          opacity={shown.opacity}
          onPreview={preview}
          onCommit={commit}
        />
      ) : (
        <>
          <SearchField label="Search colours" value={query} onChange={setQuery} />
          <BindingList
            tab={tab}
            library={library}
            query={query}
            current={current}
            onPick={commit}
          />
        </>
      )}
      {shown.bound !== null && (
        <>
          <div className="h-px bg-border" />
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted" data-testid="colour-bound">
              Bound to {displayName(shown.bound)}
            </span>
            <button
              type="button"
              className="shell-focus text-accent underline underline-offset-2"
              onClick={() => commit({ hex: shown.hex, opacity: shown.opacity })}
            >
              Detach
            </button>
          </div>
        </>
      )}
    </Popover>
  );
}

function Swatch({ hex }: { hex: string | null }) {
  return (
    <span
      aria-hidden
      className="size-4 shrink-0 shadow-[inset_0_0_0_1px_var(--border)]"
      style={{ background: hex ?? 'transparent' }}
    />
  );
}

function BindingList({
  tab,
  library,
  query,
  current,
  onPick,
}: {
  tab: 'variables' | 'styles';
  library: Library;
  query: string;
  current: ColourValue;
  onPick(v: ColourValue): void;
}) {
  const q = query.trim().toLowerCase();
  const match = (name: string) => !q || name.toLowerCase().includes(q);
  const groups =
    tab === 'variables'
      ? library.collections.map((c) => ({
          name: c.name,
          rows: library.variables
            .filter((v) => v.collection === c.id && v.type === 'color' && match(v.name))
            .map((v) => ({
              id: v.id,
              name: v.name,
              hex: normalizeHex(v.display),
              value: { variable: v.id },
              on: 'variable' in current && current.variable === v.id,
            })),
        }))
      : [
          {
            name: 'Colour styles',
            rows: library.styles
              .filter((s) => s.type === 'paint' && match(s.name))
              .map((s) => ({
                id: s.id,
                name: s.name,
                hex: s.hex,
                value: { style: s.id },
                on: 'style' in current && current.style === s.id,
              })),
          },
        ];
  const visible = groups.filter((g) => g.rows.length);
  if (!visible.length) {
    return (
      <p className="py-2 text-xs text-muted">
        {q
          ? 'No match.'
          : tab === 'variables'
            ? 'No colour variables yet.'
            : 'No colour styles yet.'}
      </p>
    );
  }
  return (
    <div className="-mx-1 max-h-72 overflow-y-auto px-1">
      {visible.map((g) => (
        <section key={g.name} aria-label={g.name}>
          <p className="type-label py-1.5 text-muted">{g.name}</p>
          <ul>
            {g.rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  aria-pressed={r.on}
                  className={`shell-focus flex h-7 w-full items-center gap-2 px-1.5 text-left ${r.on ? 'bg-accent/15' : 'hover:bg-surface'}`}
                  onClick={() => onPick(r.value)}
                >
                  <Swatch hex={r.hex} />
                  <span className="min-w-0 flex-1 truncate">{displayName(r.name)}</span>
                  <span className="font-mono text-[11px] text-muted">{r.hex ?? ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface EyeDropperApi {
  open(): Promise<{ sRGBHex: string }>;
}

function CustomColour({
  hex,
  opacity,
  onPreview,
  onCommit,
}: {
  hex: string;
  opacity: number;
  onPreview(v: ColourValue): void;
  onCommit(v: ColourValue): void;
}) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(hex));
  const [hexText, setHexText] = useState(hex);
  const [alpha, setAlpha] = useState(opacity);
  const [opacityText, setOpacityText] = useState(formatOpacity(opacity));
  const colour = hsvToHex(hsv);

  /** Show `next`; its hex. */
  const set = (next: Hsv) => {
    const h = hsvToHex(next);
    setHsv(next);
    setHexText(h);
    return h;
  };
  // Arrow keys on the square or the strip: one change per press.
  const nudge = (change: (key: string, step: number) => Hsv | null) => (e: ReactKeyboardEvent) => {
    const next = change(e.key, e.shiftKey ? 10 : 1);
    if (!next) return;
    e.preventDefault();
    onCommit({ hex: set(next), opacity: alpha });
  };

  // A drag on the square or the strip: preview each move, commit once on release.
  const drag = (pick: (fx: number, fy: number) => Hsv) => (e: ReactPointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let last = colour;
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      const next = pick(
        Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
        Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)),
      );
      last = set(next);
      onPreview({ hex: last, opacity: alpha });
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('lostpointercapture', up);
      onCommit({ hex: last, opacity: alpha });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('lostpointercapture', up);
  };

  const commitHex = () => {
    const h = normalizeHex(hexText);
    if (!h) return setHexText(colour);
    if (h === colour) return setHexText(h);
    set(hexToHsv(h));
    onCommit({ hex: h, opacity: alpha });
  };
  const commitOpacity = () => {
    const o = parseOpacity(opacityText);
    setOpacityText(formatOpacity(o ?? alpha));
    if (o === null || o === alpha) return;
    setAlpha(o);
    onCommit({ hex: colour, opacity: o });
  };
  const dropper =
    typeof window !== 'undefined'
      ? (window as { EyeDropper?: new () => EyeDropperApi }).EyeDropper
      : undefined;

  return (
    <div className="flex flex-col gap-2.5">
      <div
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={colour}
        tabIndex={0}
        data-testid="colour-area"
        className="relative h-36 cursor-crosshair touch-none"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex({ h: hsv.h, s: 1, v: 1 })})`,
        }}
        onPointerDown={drag((fx, fy) => ({ h: hsv.h, s: fx, v: 1 - fy }))}
        onKeyDown={nudge((key, step) => {
          const d = step / 100;
          const c = (n: number) => Math.min(1, Math.max(0, n));
          if (key === 'ArrowLeft') return { ...hsv, s: c(hsv.s - d) };
          if (key === 'ArrowRight') return { ...hsv, s: c(hsv.s + d) };
          if (key === 'ArrowUp') return { ...hsv, v: c(hsv.v + d) };
          if (key === 'ArrowDown') return { ...hsv, v: c(hsv.v - d) };
          return null;
        })}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.5)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
        />
      </div>
      <div
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        tabIndex={0}
        className="relative h-3 cursor-ew-resize touch-none"
        style={{
          background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
        }}
        onPointerDown={drag((fx) => ({ ...hsv, h: fx * 360 }))}
        onKeyDown={nudge((key, step) => {
          if (key === 'ArrowLeft' || key === 'ArrowDown')
            return { ...hsv, h: Math.max(0, hsv.h - step) };
          if (key === 'ArrowRight' || key === 'ArrowUp')
            return { ...hsv, h: Math.min(360, hsv.h + step) };
          return null;
        })}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 h-3 w-1 -translate-x-1/2 border border-white shadow-[0_0_0_1px_rgb(0_0_0/0.5)]"
          style={{ left: `${(hsv.h / 360) * 100}%` }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Swatch hex={colour} />
        <input
          aria-label="Hex"
          data-autofocus
          value={hexText}
          spellCheck={false}
          className="h-7 min-w-0 flex-1 bg-bg px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-[var(--focus)]"
          onChange={(e) => setHexText(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => e.key === 'Enter' && commitHex()}
        />
        <input
          aria-label="Opacity"
          value={opacityText}
          className="h-7 w-14 bg-bg px-2 text-right font-mono text-xs outline-none focus:ring-1 focus:ring-[var(--focus)]"
          onChange={(e) => setOpacityText(e.target.value)}
          onBlur={commitOpacity}
          onKeyDown={(e) => e.key === 'Enter' && commitOpacity()}
        />
        {dropper && (
          <button
            type="button"
            aria-label="Pick a colour from the screen"
            title="Eyedropper"
            className="shell-focus grid size-7 place-items-center text-muted hover:bg-surface hover:text-text"
            onClick={() => {
              new dropper()
                .open()
                .then((r) => {
                  const h = normalizeHex(r.sRGBHex);
                  if (!h) return;
                  set(hexToHsv(h));
                  onCommit({ hex: h, opacity: alpha });
                })
                .catch(() => {}); // dismissed
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <path d="M10 2.5l3.5 3.5M11.5 4.5L4 12l-1.5 1.5M4 12l-1 2.5L5.5 13.5 13 6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
