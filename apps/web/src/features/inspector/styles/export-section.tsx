'use client';

/**
 * The export panel (Story 5.11): a layer's export settings (`exports`: size and format each,
 * kept in the file) with add, change and remove, and one button that downloads every setting's
 * file, rendered by the editor (`file.export`, as Story 7.1's menu does).
 */
import { base64ToBytes } from '@greenfield/bridge';
import type { NodeFields } from '@greenfield/editor-state';
import { useEditorStore } from '@greenfield/editor-state/react';
import { useState } from 'react';
import {
  download,
  EXPORT_FORMATS,
  exportFileName,
  FORMATS,
  type ExportFormat,
} from '@/features/export/export';
import { IconButton, MINUS, PLUS, Section, Select, useRun } from './ui';

interface ExportSetting {
  format: string;
  size: { by: 'scale' | 'width' | 'height'; value: number };
  suffix: string;
}

const SCALES = [0.5, 1, 2, 3, 4];

/** A setting's size as the editor writes it: `2x`, `512w`, `512h`. */
export const sizeText = (s: ExportSetting['size']) =>
  `${s.value}${s.by === 'scale' ? 'x' : s.by === 'width' ? 'w' : 'h'}`;

/** The render scale for a setting: a width or height setting scales the layer to it. */
export function renderScale(s: ExportSetting['size'], node: NodeFields): number {
  if (s.by === 'scale') return s.value;
  const side = Number(s.by === 'width' ? node.width : node.height);
  return side > 0 ? s.value / side : 1;
}

const isFormat = (f: string): f is ExportFormat =>
  (EXPORT_FORMATS as readonly string[]).includes(f);

export function ExportSection({ node }: { node: NodeFields }) {
  const store = useEditorStore();
  const { run, error } = useRun();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const settings = (Array.isArray(node.exports) ? node.exports : []) as ExportSetting[];
  const ids = [node.id];
  const name = typeof node.name === 'string' && node.name ? node.name : 'Export';

  const exportAll = async () => {
    setBusy(true);
    setFailed(null);
    try {
      for (const s of settings) {
        const format = isFormat(s.format) ? s.format : 'png';
        const scale = FORMATS[format].raster ? renderScale(s.size, node) : 1;
        const r = (await store.run('file.export', { ids, format, scale })) as { data?: unknown };
        if (typeof r?.data !== 'string') throw new Error('The editor returned no file.');
        download({
          fileName: exportFileName(`${name}${s.suffix}`, format, scale),
          mime: FORMATS[format].mime,
          bytes: base64ToBytes(r.data),
        });
      }
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Export"
      action={
        <IconButton label="Add export setting" onClick={() => run('export.add', { ids })}>
          {PLUS}
        </IconButton>
      }
    >
      {settings.map((s, index) => (
        <div key={index} className="flex items-center gap-1.5" data-testid="export-setting">
          <Select
            aria-label={`Size ${index + 1}`}
            value={sizeText(s.size)}
            onChange={(e) => run('export.update', { ids, index, size: e.target.value })}
          >
            {!SCALES.some((x) => `${x}x` === sizeText(s.size)) && (
              <option value={sizeText(s.size)}>{sizeText(s.size)}</option>
            )}
            {SCALES.map((x) => (
              <option key={x} value={`${x}x`}>
                {x}x
              </option>
            ))}
          </Select>
          <Select
            aria-label={`Format ${index + 1}`}
            value={s.format}
            onChange={(e) => run('export.update', { ids, index, format: e.target.value })}
          >
            {!isFormat(s.format) && <option value={s.format}>{s.format.toUpperCase()}</option>}
            {EXPORT_FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMATS[f].label}
              </option>
            ))}
          </Select>
          <IconButton
            label={`Remove export setting ${index + 1}`}
            onClick={() => run('export.remove', { ids, index })}
          >
            {MINUS}
          </IconButton>
        </div>
      ))}
      {settings.length > 0 && (
        <button
          type="button"
          className="btn-ghost w-full text-xs"
          disabled={busy}
          onClick={exportAll}
        >
          {busy ? 'Exporting…' : `Export ${name}`}
        </button>
      )}
      {(error ?? failed) && (
        <p role="alert" className="text-xs text-danger">
          {error ?? failed}
        </p>
      )}
    </Section>
  );
}
