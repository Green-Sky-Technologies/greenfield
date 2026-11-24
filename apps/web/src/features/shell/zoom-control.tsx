'use client';

/**
 * Zoom (Story 5.1), through the bridge's `view.*` commands. The level is read back with
 * `view.get` after each command and once a second, since the canvas zooms with the wheel and
 * trackpad too.
 */
import type { CommandId, Editor } from '@greenfield/bridge';
import { useEffect, useState } from 'react';

const POLL_MS = 1000;

const PRESETS: { command: CommandId; label: string }[] = [
  { command: 'view.zoomFit', label: 'Zoom to fit' },
  { command: 'view.zoomSelection', label: 'Zoom to selection' },
  { command: 'view.zoom100', label: 'Zoom to 100%' },
];

interface Props {
  editor: Editor | null;
  open: boolean;
  onToggle: () => void;
}

export function ZoomControl({ editor, open, onToggle }: Props) {
  const zoom = useZoom(editor);
  const run = (command: CommandId) => {
    editor
      ?.execute(command, {})
      .then(zoom.refresh)
      .catch(() => {}); // no document yet, or a hidden tab: nothing to zoom
  };
  const disabled = !editor || zoom.level === null;
  const pct = zoom.level === null ? '–' : `${Math.round(zoom.level * 100)}%`;

  return (
    <div className="relative flex items-center border border-border" role="group" aria-label="Zoom">
      <button
        type="button"
        className="shell-focus flex size-7 items-center justify-center text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
        onClick={() => run('view.zoomOut')}
        disabled={disabled}
        aria-label="Zoom out"
      >
        <span aria-hidden>−</span>
      </button>
      <button
        type="button"
        className="shell-focus h-7 w-14 border-x border-border text-xs tabular-nums text-text hover:bg-surface-2 disabled:opacity-40"
        onClick={onToggle}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Zoom level ${pct}, zoom options`}
      >
        {pct}
      </button>
      <button
        type="button"
        className="shell-focus flex size-7 items-center justify-center text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
        onClick={() => run('view.zoomIn')}
        disabled={disabled}
        aria-label="Zoom in"
      >
        <span aria-hidden>+</span>
      </button>
      {open && (
        <ul
          role="menu"
          aria-label="Zoom options"
          className="absolute top-full right-0 z-30 mt-1 w-48 border border-border bg-surface py-1 shadow-[0_8px_24px_-12px_rgb(7_54_66/0.35)]"
        >
          {PRESETS.map((p) => (
            <li key={p.command} role="none">
              <button
                type="button"
                role="menuitem"
                className="shell-focus w-full px-3 py-1.5 text-left hover:bg-surface-2"
                onClick={() => {
                  run(p.command);
                  onToggle();
                }}
              >
                {p.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The canvas zoom (1 = 100%), or null before a document is open. */
function useZoom(editor: Editor | null) {
  const [level, setLevel] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    let live = true;
    const read = () =>
      editor
        .execute('view.get', {})
        .then((v) => {
          const z = (v as { zoom?: unknown } | null)?.zoom;
          if (live) setLevel(typeof z === 'number' ? z : null);
        })
        .catch(() => {}); // not ready, hidden, or no document: keep the last value
    read();
    const t = setInterval(read, POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [editor, tick]);
  return { level, refresh: () => setTick((n) => n + 1) };
}
