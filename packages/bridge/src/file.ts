/**
 * Reading a saved `.figcraft` document without the editor (Story 6.1): the server mirrors the
 * file's comment threads into Postgres on save (D23).
 *
 * The pinned editor (figcraft-web 0.18.1) saves a zip holding `document.json` (format
 * `figcraft`, version 1) and `thumbnail.png`. Threads are `document.json`'s `comments`: page,
 * anchor layer, author, text, created (Unix seconds), resolved and replies. Positions are
 * relative to the anchor, so they're left out here; ask the editor (`listComments`) for pins.
 *
 * The zip reader and writer at the end also serve the design-system library rewrite (Story 10.3).
 * Works in Node and browsers (`CompressionStream`, `DecompressionStream`); no dependencies.
 */

export interface FileCommentMessage {
  author: string;
  text: string;
  /** Unix seconds. */
  created: number;
  /** Unix seconds; absent if never edited. */
  edited?: number;
}

export interface FileCommentThread extends FileCommentMessage {
  /** Per document; reused after a thread is deleted. */
  id: number;
  page: number;
  /** The layer the pin follows, or null when it's pinned to the page. */
  anchor: number | null;
  resolved: boolean;
  replies: FileCommentMessage[];
}

/**
 * The comment threads in a saved document, or null when the bytes aren't a `.figcraft` file
 * this reader understands (not a zip, no `document.json`, another format or version).
 */
export async function readFileComments(bytes: Uint8Array): Promise<FileCommentThread[] | null> {
  const json = await readZipEntry(bytes, 'document.json');
  if (!json) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder().decode(json));
  } catch {
    return null;
  }
  if (!isRecord(doc) || doc.format !== 'figcraft' || doc.version !== 1) return null;
  const comments = Array.isArray(doc.comments) ? doc.comments : [];
  return comments.flatMap((c) => {
    const t = thread(c);
    return t ? [t] : [];
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
/** Unix seconds a `Date` can hold. */
const isTime = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 8.64e12;

function message(v: unknown): FileCommentMessage | null {
  if (!isRecord(v) || typeof v.author !== 'string' || typeof v.text !== 'string') return null;
  if (!isTime(v.created)) return null;
  const m: FileCommentMessage = { author: v.author, text: v.text, created: v.created };
  if (isTime(v.edited) && v.edited > 0) m.edited = v.edited;
  return m;
}

function thread(v: unknown): FileCommentThread | null {
  const m = message(v);
  if (!m || !isRecord(v) || !isInt(v.id) || !isInt(v.page)) return null;
  return {
    ...m,
    id: v.id,
    page: v.page,
    anchor: isInt(v.anchor) ? v.anchor : null,
    resolved: v.resolved === true,
    replies: (Array.isArray(v.replies) ? v.replies : []).flatMap((r) => {
      const reply = message(r);
      return reply ? [reply] : [];
    }),
  };
}

// ---- a minimal zip reader and writer: stored or deflated entries, no zip64 ----

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

interface StoredEntry {
  name: Uint8Array;
  method: number;
  data: Uint8Array;
}

/** The entries' names and stored bytes from the central directory, or null if it's unreadable. */
function zipEntries(zip: Uint8Array): StoredEntry[] | null {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const u32 = (at: number) => (at >= 0 && at + 4 <= zip.byteLength ? view.getUint32(at, true) : -1);
  const u16 = (at: number) => (at >= 0 && at + 2 <= zip.byteLength ? view.getUint16(at, true) : -1);

  // The end-of-central-directory record is in the last 22 + 65535 (comment) bytes.
  let eocd = -1;
  for (let i = zip.byteLength - 22; i >= Math.max(0, zip.byteLength - 22 - 0xffff); i--) {
    if (u32(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = u16(eocd + 10);
  let at = u32(eocd + 16);
  const entries: StoredEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (u32(at) !== CENTRAL) return null;
    const method = u16(at + 10);
    const compressed = u32(at + 20);
    const nameLen = u16(at + 28);
    const local = u32(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLen);
    at += 46 + nameLen + u16(at + 30) + u16(at + 32);
    if (u32(local) !== LOCAL) return null;
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (start + compressed > zip.byteLength) return null;
    entries.push({ name, method, data: zip.subarray(start, start + compressed) });
  }
  return entries;
}

async function entryBytes({ method, data }: StoredEntry): Promise<Uint8Array | null> {
  if (method === 0) return data.slice();
  if (method !== 8) return null;
  try {
    return await transform(data, new DecompressionStream('deflate-raw'));
  } catch {
    return null;
  }
}

/** One entry's bytes, or null when the zip is unreadable or has no such entry. */
export async function readZipEntry(zip: Uint8Array, name: string): Promise<Uint8Array | null> {
  const wanted = new TextEncoder().encode(name);
  const entry = zipEntries(zip)?.find((e) => sameBytes(e.name, wanted));
  return entry ? entryBytes(entry) : null;
}

/** Every entry by name, in zip order, or null when the zip or any entry is unreadable. */
export async function readZip(zip: Uint8Array): Promise<Map<string, Uint8Array> | null> {
  const entries = zipEntries(zip);
  if (!entries) return null;
  const out = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (const e of entries) {
    const bytes = await entryBytes(e);
    if (!bytes) return null;
    out.set(decoder.decode(e.name), bytes);
  }
  return out;
}

/** A zip of the entries in order, each deflated, with UTF-8 names. */
export async function writeZip(entries: Iterable<[string, Uint8Array]>): Promise<Uint8Array> {
  const records: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  let count = 0;
  for (const [entryName, raw] of entries) {
    const name = new TextEncoder().encode(entryName);
    const data = await transform(raw, new CompressionStream('deflate-raw'));
    const crc = crc32(raw);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL, true);
    local.setUint16(4, 20, true); // version needed: 2.0
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 8, true); // deflate
    local.setUint32(14, crc, true);
    local.setUint32(18, data.byteLength, true);
    local.setUint32(22, raw.byteLength, true);
    local.setUint16(26, name.byteLength, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, CENTRAL, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 8, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.byteLength, true);
    central.setUint32(24, raw.byteLength, true);
    central.setUint16(28, name.byteLength, true);
    central.setUint32(42, offset, true);
    records.push(new Uint8Array(local.buffer), name, data);
    directory.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.byteLength + data.byteLength;
    count++;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, EOCD, true);
  end.setUint16(8, count, true);
  end.setUint16(10, count, true);
  end.setUint32(
    12,
    directory.reduce((n, b) => n + b.byteLength, 0),
    true,
  );
  end.setUint32(16, offset, true);
  return concat([...records, ...directory, new Uint8Array(end.buffer)]);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

async function transform(
  data: Uint8Array,
  stream: TransformStream<BufferSource, Uint8Array>,
): Promise<Uint8Array> {
  const out = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
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
