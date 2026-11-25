/**
 * A design system's library file, read and rewritten on the server without the editor.
 *
 * A `.figcraft` file is a zip whose `document.json` (format `figcraft`, version 1) holds the
 * variables, styles and layer tree. Reviewing (Story 10.3) only needs names and values from it,
 * and dropping an item is deleting JSON records and the references to them, so a server-side
 * reader is simpler than driving a hidden editor and gives the same file the editor would save.
 * Entries this module doesn't understand (thumbnail, images) are copied through unchanged; a
 * FigCraft-published library snapshot (`library/*`) is left out, since it would still hold what
 * the review dropped.
 */
import type { DesignSystemItem } from '@greenfield/db';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { ValidationError } from '../types';

type Json = Record<string, unknown>;

/** The parts of `document.json` this module reads or rewrites; everything else passes through. */
export interface FigcraftDocument extends Json {
  format: 'figcraft';
  version: 1;
  pages: number[];
  nodes: Record<string, Json>;
  next_id?: number;
  current_page?: number | null;
  styles?: Json[];
  variables?: { collections?: Json[]; variables?: Json[] };
}

export interface LibraryFile {
  doc: FigcraftDocument;
  /** The zip's other entries, in order. */
  entries: [string, Uint8Array][];
}

const DOCUMENT = 'document.json';
const NOT_A_LIBRARY = 'That is not a FigCraft file (.figcraft).';

export function readLibraryFile(bytes: Uint8Array): LibraryFile {
  const zip = readZip(bytes);
  const json = zip?.get(DOCUMENT);
  if (!zip || !json) throw new ValidationError(NOT_A_LIBRARY);
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new ValidationError(NOT_A_LIBRARY);
  }
  if (
    !isRecord(doc) ||
    doc.format !== 'figcraft' ||
    doc.version !== 1 ||
    !Array.isArray(doc.pages) ||
    !isRecord(doc.nodes)
  )
    throw new ValidationError(NOT_A_LIBRARY);
  const entries = [...zip].filter(([name]) => name !== DOCUMENT && !name.startsWith('library/'));
  return { doc: doc as FigcraftDocument, entries };
}

export function writeLibraryFile(file: LibraryFile): Uint8Array {
  return writeZip([
    [DOCUMENT, new TextEncoder().encode(JSON.stringify(file.doc))],
    ...file.entries,
  ]);
}

// ---- review items ----

const isRecord = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const variablesOf = (doc: FigcraftDocument) => doc.variables?.variables ?? [];
const stylesOf = (doc: FigcraftDocument) => doc.styles ?? [];
const folder = (name: string) => (name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '');

function hex(c: unknown): string | null {
  if (!isRecord(c)) return null;
  const ch = [c.r, c.g, c.b, c.a ?? 1].map((x) =>
    Math.round(Math.min(1, Math.max(0, Number(x) || 0)) * 255)
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${ch.slice(0, 3).join('')}${ch[3] === 'ff' ? '' : ch[3]}`;
}

/** A colour variable's value in its collection's first mode, following aliases. */
function variableHex(doc: FigcraftDocument, v: Json, depth = 0): string | null {
  const values = isRecord(v.values) ? Object.values(v.values) : [];
  const first = values[0];
  if (!isRecord(first)) return null;
  if (first.type === 'color') return hex(first.value);
  if (first.type === 'alias' && depth < 8) {
    const target = variablesOf(doc).find((x) => x.id === first.value);
    return target ? variableHex(doc, target, depth + 1) : null;
  }
  return null;
}

/** Component and component set roots on the document's pages (variants come with their set). */
function componentRoots(doc: FigcraftDocument): Json[] {
  const roots: Json[] = [];
  const walk = (id: unknown) => {
    const n = doc.nodes[String(id)];
    if (!n) return;
    if (n.type === 'component' || n.type === 'componentSet') {
      roots.push(n);
      return;
    }
    for (const c of Array.isArray(n.children) ? n.children : []) walk(c);
  };
  for (const page of doc.pages) walk(page);
  return roots;
}

/** What a review offers: colour groups, type styles and components, in file order. */
export function libraryItems(doc: FigcraftDocument): DesignSystemItem[] {
  const items: DesignSystemItem[] = [];
  for (const c of doc.variables?.collections ?? []) {
    const colours = variablesOf(doc)
      .filter((v) => v.collection === c.id && v.resolvedType === 'color')
      .map((v) => ({ name: str(v.name), hex: variableHex(doc, v) }));
    if (colours.length)
      items.push({ key: `colours:${str(c.id)}`, kind: 'colours', name: str(c.name), colours });
  }
  const paintFolders = new Map<string, { name: string; hex: string | null }[]>();
  for (const s of stylesOf(doc).filter((s) => s.type === 'paint')) {
    const name = str(s.name);
    const paint = Array.isArray(s.paints) ? s.paints[0] : null;
    const list = paintFolders.get(folder(name)) ?? [];
    list.push({ name, hex: isRecord(paint) && paint.type === 'solid' ? hex(paint.color) : null });
    paintFolders.set(folder(name), list);
  }
  for (const [f, colours] of paintFolders)
    items.push({
      key: `colours:styles/${f}`,
      kind: 'colours',
      name: f ? `${f} styles` : 'Colour styles',
      colours,
    });
  for (const s of stylesOf(doc).filter((s) => s.type === 'text')) {
    const style = isRecord(s.style) ? s.style : {};
    items.push({
      key: `type:${str(s.id)}`,
      kind: 'type',
      name: str(s.name),
      fontFamily: str(style.font_family),
      fontStyle: str(style.font_style, 'Regular'),
      fontSize: Number(style.font_size) || 0,
    });
  }
  for (const n of componentRoots(doc))
    items.push({
      key: `component:${String(n.id)}`,
      kind: 'component',
      name: str(n.name),
      variants: n.type === 'componentSet' && Array.isArray(n.children) ? n.children.length : 1,
    });
  return items;
}

// ---- dropping items ----

/**
 * The document without the dropped items, and without what pointed at them: layers bound to a
 * dropped variable keep their stored value, layers using a dropped style keep their look,
 * instances of a dropped component are removed with it, and a collection left empty goes too.
 */
export function dropItems(doc: FigcraftDocument, dropped: ReadonlySet<string>): FigcraftDocument {
  const out = structuredClone(doc);
  const goneVariables = new Set<unknown>();
  const goneStyles = new Set<unknown>();
  const goneComponents = new Set<unknown>();
  for (const key of dropped) {
    const [kind, rest = ''] = splitKey(key);
    if (kind === 'colours' && rest.startsWith('styles/')) {
      const f = rest.slice('styles/'.length);
      for (const s of stylesOf(out))
        if (s.type === 'paint' && folder(str(s.name)) === f) goneStyles.add(s.id);
    } else if (kind === 'colours') {
      for (const v of variablesOf(out))
        if (v.collection === rest && v.resolvedType === 'color') goneVariables.add(v.id);
    } else if (kind === 'type') goneStyles.add(rest);
    else if (kind === 'component') goneComponents.add(Number(rest));
  }

  if (out.variables) {
    const vars = variablesOf(out).filter((v) => !goneVariables.has(v.id));
    const used = new Set(vars.map((v) => v.collection));
    out.variables.variables = vars;
    out.variables.collections = (out.variables.collections ?? []).filter(
      (c) => used.has(c.id) || !variablesOf(doc).some((v) => v.collection === c.id),
    );
  }
  if (out.styles) out.styles = out.styles.filter((s) => !goneStyles.has(s.id));

  // Components (with their variants) and every instance of them, with their subtrees.
  const removed = new Set<string>();
  const remove = (id: string) => {
    const n = out.nodes[id];
    if (!n || removed.has(id)) return;
    removed.add(id);
    for (const c of Array.isArray(n.children) ? n.children : []) remove(String(c));
  };
  for (const id of goneComponents) remove(String(id));
  for (const [id, n] of Object.entries(out.nodes))
    if (n.type === 'instance' && removed.has(String(n.component))) remove(id);
  for (const id of removed) delete out.nodes[id];

  for (const n of Object.values(out.nodes)) {
    if (Array.isArray(n.children)) n.children = n.children.filter((c) => !removed.has(String(c)));
    if (isRecord(n.bound))
      for (const [field, v] of Object.entries(n.bound))
        if (goneVariables.has(v)) delete n.bound[field];
    if (isRecord(n.styles))
      for (const [slot, s] of Object.entries(n.styles))
        if (goneStyles.has(s)) n.styles[slot] = null;
    if (isRecord(n.style) && goneStyles.has(n.style.style_id)) delete n.style.style_id;
  }
  for (const v of variablesOf(out)) {
    if (!isRecord(v.values)) continue;
    for (const [mode, value] of Object.entries(v.values))
      if (isRecord(value) && value.type === 'alias' && goneVariables.has(value.value)) {
        const target = variablesOf(doc).find((x) => x.id === value.value);
        const resolved = target && variableHex(doc, target);
        if (resolved) v.values[mode] = { type: 'color', value: rgba(resolved) };
      }
  }
  return out;
}

function splitKey(key: string): [string, string] {
  const i = key.indexOf(':');
  return i < 0 ? [key, ''] : [key.slice(0, i), key.slice(i + 1)];
}

function rgba(h: string) {
  const n = (i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2) || 'ff', 16) / 255;
  return { r: n(0), g: n(1), b: n(2), a: n(3) };
}

// ---- starting a file from a system ----

/**
 * The first document of a new file that uses the system (Story 10.4): the published library
 * (its variables, styles and components, with their ids unchanged) behind a new empty first
 * page, which the file opens on. The library's pages are renamed after the system.
 */
export function startingDocument(doc: FigcraftDocument, systemName: string): FigcraftDocument {
  const out = structuredClone(doc);
  const ids = Object.keys(out.nodes).map(Number);
  const pageId = Math.max(out.next_id ?? 0, ...ids, 0) + 1;
  out.pages.forEach((id, i) => {
    const page = out.nodes[String(id)];
    if (page)
      page.name =
        out.pages.length === 1 ? systemName : `${systemName} / ${str(page.name, `Page ${i + 1}`)}`;
  });
  const first = out.nodes[String(out.pages[0])] ?? {};
  out.nodes[String(pageId)] = {
    background: first.background,
    prototype: first.prototype,
    id: pageId,
    name: 'Page 1',
    type: 'page',
    flows: [],
    children: [],
    width: 0,
    height: 0,
  };
  out.pages = [pageId, ...out.pages];
  out.current_page = pageId;
  out.next_id = pageId + 1;
  out.comments = [];
  return out;
}

// ---- a minimal zip reader and writer (stored or deflated entries) ----

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function readZip(zip: Uint8Array): Map<string, Uint8Array> | null {
  const buf = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  const u32 = (at: number) => (at >= 0 && at + 4 <= buf.length ? buf.readUInt32LE(at) : -1);
  const u16 = (at: number) => (at >= 0 && at + 2 <= buf.length ? buf.readUInt16LE(at) : -1);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--)
    if (u32(i) === EOCD) {
      eocd = i;
      break;
    }
  if (eocd < 0) return null;
  const out = new Map<string, Uint8Array>();
  let at = u32(eocd + 16);
  for (let n = u16(eocd + 10); n > 0; n--) {
    if (u32(at) !== CENTRAL) return null;
    const method = u16(at + 10);
    const size = u32(at + 20);
    const nameLen = u16(at + 28);
    const local = u32(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    at += 46 + nameLen + u16(at + 30) + u16(at + 32);
    if (u32(local) !== LOCAL) return null;
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (start + size > buf.length) return null;
    const data = buf.subarray(start, start + size);
    try {
      if (method === 0) out.set(name, new Uint8Array(data));
      else if (method === 8) out.set(name, new Uint8Array(inflateRawSync(data)));
      else return null;
    } catch {
      return null;
    }
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeZip(entries: [string, Uint8Array][]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, raw] of entries) {
    const fileName = Buffer.from(name, 'utf8');
    const data = deflateRawSync(raw);
    const crc = crc32(raw);
    const header = (size: number, sig: number) => {
      const h = Buffer.alloc(size);
      h.writeUInt32LE(sig, 0);
      return h;
    };
    const local = header(30, LOCAL);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const dir = header(46, CENTRAL);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(fileName.length, 28);
    dir.writeUInt32LE(offset, 42);
    parts.push(local, fileName, data);
    central.push(dir, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, ...central, end]));
}
