'use client';

/**
 * Export menu (Story 7.1): PNG, JPG, WebP, SVG or PDF of the selection or a top-level frame,
 * rendered by the editor and downloaded by the browser. Every role may use it
 * (`export:deterministic`); the caller decides whether to mount it.
 */
import { useState } from 'react';
import {
  download,
  EXPORT_FORMATS,
  exportFile,
  exportTargets,
  FORMATS,
  type ExportEditor,
  type ExportFormat,
  type ExportTarget,
} from './export';

const SCALES = [1, 2, 3] as const;

export function ExportMenu({ editor }: { editor: ExportEditor }) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<ExportTarget[] | null>(null);
  const [targetKey, setTargetKey] = useState('');
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    setError(null);
    setTargets(null);
    try {
      const t = await exportTargets(editor);
      setTargets(t);
      setTargetKey(t[0]?.key ?? '');
    } catch (e) {
      setError(message(e));
    }
  }

  async function run() {
    const target = targets?.find((t) => t.key === targetKey);
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      download(await exportFile(editor, target, format, scale));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <button
        type="button"
        className="btn-link"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        Export
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Export"
          className="card absolute right-0 top-full z-10 mt-1 flex w-64 flex-col gap-2 p-3 text-sm shadow-lg"
        >
          {targets === null && !error && <p className="text-muted">Loading…</p>}
          {targets?.length === 0 && (
            <p className="text-muted">Select a layer or add a frame to export.</p>
          )}
          {targets && targets.length > 0 && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium">Layer</span>
                <select
                  className="input py-1"
                  value={targetKey}
                  onChange={(e) => setTargetKey(e.target.value)}
                >
                  {targets.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-xs font-medium">Format</span>
                  <select
                    className="input py-1"
                    value={format}
                    onChange={(e) => setFormat(e.target.value as ExportFormat)}
                  >
                    {EXPORT_FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {FORMATS[f].label}
                      </option>
                    ))}
                  </select>
                </label>
                {FORMATS[format].raster && (
                  <label className="flex w-20 flex-col gap-1">
                    <span className="text-xs font-medium">Scale</span>
                    <select
                      className="input py-1"
                      value={scale}
                      onChange={(e) => setScale(Number(e.target.value))}
                    >
                      {SCALES.map((s) => (
                        <option key={s} value={s}>
                          {s}x
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <button type="button" className="btn-primary" disabled={busy} onClick={run}>
                {busy ? 'Exporting…' : `Export ${FORMATS[format].label}`}
              </button>
            </>
          )}
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
