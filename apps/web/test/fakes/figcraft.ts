import { deflateRawSync } from 'node:zlib';

/** A comment thread as the editor stores it in `document.json` (Story 6.1). */
export interface StoredThread {
  id: number;
  page?: number;
  x?: number;
  y?: number;
  anchor?: number | null;
  author: string;
  text: string;
  created: number;
  resolved?: boolean;
  replies?: { author: string; text: string; created: number; edited?: number }[];
}

/**
 * A minimal `.figcraft` file with these comment threads: a zip holding a deflated
 * `document.json`, the shape figcraft-web 0.18.1 saves (CRCs left at zero; nothing checks them).
 */
export function figcraftFile(threads: StoredThread[]): Uint8Array {
  const doc = {
    format: 'figcraft',
    version: 1,
    name: 'Untitled',
    pages: [1],
    nodes: {},
    comments: threads.map((t) => ({
      page: 1,
      x: 0,
      y: 0,
      anchor: null,
      resolved: false,
      replies: [],
      read_by: [],
      ...t,
    })),
  };
  const raw = Buffer.from(JSON.stringify(doc));
  const data = deflateRawSync(raw);
  const name = Buffer.from('document.json');

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(local.length + name.length + data.length, 16);

  return new Uint8Array(Buffer.concat([local, name, data, central, name, eocd]));
}
