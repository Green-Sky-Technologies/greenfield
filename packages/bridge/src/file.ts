/**
 * Reading a saved `.figcraft` document without the editor (Story 6.1): the server mirrors the
 * file's comment threads into Postgres on save (D23).
 *
 * The pinned editor (figcraft-web 0.18.1) saves a zip holding `document.json` (format
 * `figcraft`, version 1) and `thumbnail.png`. Threads are `document.json`'s `comments`: page,
 * anchor layer, author, text, created (Unix seconds), resolved and replies. Positions are
 * relative to the anchor, so they're left out here; ask the editor (`listComments`) for pins.
 *
 * Works in Node and browsers (`DecompressionStream`); no dependencies.
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

// ---- a minimal zip reader: the central directory, stored or deflated entries ----

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** One entry's bytes, or null when the zip is unreadable or has no such entry. */
async function readZipEntry(zip: Uint8Array, name: string): Promise<Uint8Array | null> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const u32 = (at: number) => (at + 4 <= zip.byteLength ? view.getUint32(at, true) : -1);
  const u16 = (at: number) => (at + 2 <= zip.byteLength ? view.getUint16(at, true) : -1);

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
  const wanted = new TextEncoder().encode(name);

  for (let n = 0; n < count; n++) {
    if (u32(at) !== CENTRAL) return null;
    const method = u16(at + 10);
    const compressed = u32(at + 20);
    const nameLen = u16(at + 28);
    const extraLen = u16(at + 30);
    const commentLen = u16(at + 32);
    const local = u32(at + 42);
    const entryName = zip.subarray(at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (!sameBytes(entryName, wanted)) continue;

    if (u32(local) !== LOCAL) return null;
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (start + compressed > zip.byteLength) return null;
    const data = zip.subarray(start, start + compressed);
    if (method === 0) return data;
    if (method !== 8) return null;
    try {
      return await inflateRaw(data);
    } catch {
      return null;
    }
  }
  return null;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
