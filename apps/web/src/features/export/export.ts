/**
 * Built-in exports (Story 7.1): the editor's own `file.export`, through `@greenfield/bridge`.
 * No server and no model: the editor renders the file and the browser downloads it. This is a
 * user action, not an agent tool (`run_batch` blocks export commands for the agent).
 *
 * Framework-free so the top bar (Epic 5) can reuse it with whatever `Editor` it holds.
 */
import { base64ToBytes, CommandError, type Editor, type NodeId } from '@greenfield/bridge';

export const EXPORT_FORMATS = ['png', 'jpg', 'webp', 'svg', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const FORMATS: Record<ExportFormat, { label: string; mime: string; raster: boolean }> = {
  png: { label: 'PNG', mime: 'image/png', raster: true },
  jpg: { label: 'JPG', mime: 'image/jpeg', raster: true },
  webp: { label: 'WebP', mime: 'image/webp', raster: true },
  svg: { label: 'SVG', mime: 'image/svg+xml', raster: false },
  pdf: { label: 'PDF', mime: 'application/pdf', raster: false },
};

/** What the export menu needs from the editor. */
export type ExportEditor = Pick<Editor, 'execute' | 'inspect'>;

/** Something to export: the selection, or a top-level frame of the current page. */
export interface ExportTarget {
  /** `selection` or the frame's id. */
  key: string;
  label: string;
  ids: NodeId[];
  /** The download's base name. */
  name: string;
}

/** The selection (when there is one) and every top-level frame of the current page. */
export async function exportTargets(editor: ExportEditor): Promise<ExportTarget[]> {
  const doc = await editor.inspect({ depth: 1, fields: ['name', 'type'] });
  const page = doc.pages.find((p) => p.id === doc.currentPage) ?? doc.pages[0];
  const top = page?.children ?? [];
  const frames = top.filter((n) => n.type === 'FRAME');
  const targets: ExportTarget[] = [];
  if (doc.selection.length > 0) {
    const only = doc.selection.length === 1 ? top.find((n) => n.id === doc.selection[0]) : null;
    targets.push({
      key: 'selection',
      label:
        doc.selection.length === 1
          ? `Selection${only?.name ? ` (${only.name})` : ''}`
          : `Selection (${doc.selection.length} layers)`,
      ids: doc.selection,
      name: only?.name || doc.name.replace(/\.figcraft$/i, '') || 'Export',
    });
  }
  for (const f of frames) {
    const name = f.name || `Frame ${f.id}`;
    targets.push({ key: String(f.id), label: name, ids: [f.id], name });
  }
  return targets;
}

export interface ExportedFile {
  fileName: string;
  mime: string;
  bytes: Uint8Array;
}

/** A file name that's safe on every OS, e.g. `Card@2x.png`. */
export function exportFileName(name: string, format: ExportFormat, scale: number): string {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'Export';
  const suffix = FORMATS[format].raster && scale !== 1 ? `@${scale}x` : '';
  return `${base}${suffix}.${format}`;
}

/** Ask the editor for the file. Vector formats ignore `scale`. */
export async function exportFile(
  editor: ExportEditor,
  target: Pick<ExportTarget, 'ids' | 'name'>,
  format: ExportFormat,
  scale = 1,
): Promise<ExportedFile> {
  const s = FORMATS[format].raster ? scale : 1;
  const r = (await editor.execute('file.export', { ids: target.ids, format, scale: s })) as {
    data?: unknown;
  } | null;
  if (typeof r?.data !== 'string' || r.data.length === 0) {
    throw new CommandError('engine.execute', 'file.export', 'the editor returned no file');
  }
  return {
    fileName: exportFileName(target.name, format, s),
    mime: FORMATS[format].mime,
    bytes: base64ToBytes(r.data),
  };
}

/** Hand the file to the browser as a download. */
export function download(file: ExportedFile): void {
  const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.fileName;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled; revoking at once can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
