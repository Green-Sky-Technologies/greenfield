import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readFileComments, readZip, readZipEntry, writeZip } from '../src/file';

/** Saved by the pinned editor (e2e/comments.spec.ts makes the same document). */
const fixture = new Uint8Array(
  fs.readFileSync(new URL('./fixtures/comments.figcraft', import.meta.url)),
);

/** A one-entry zip, stored or deflated (CRCs are zero: the reader doesn't check them). */
function zip(name: string, content: string, deflate = true): Uint8Array {
  const raw = Buffer.from(content);
  const data = deflate ? deflateRawSync(raw) : raw;
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(deflate ? 8 : 0, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(deflate ? 8 : 0, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(0, 42);
  const cdStart = 30 + n.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + n.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return new Uint8Array(Buffer.concat([local, n, data, central, n, eocd]));
}

const doc = (comments: unknown) => JSON.stringify({ format: 'figcraft', version: 1, comments });

describe('readFileComments', () => {
  it("reads the editor's own file: anchor, replies, edits, resolved", async () => {
    expect(await readFileComments(fixture)).toEqual([
      {
        id: 1,
        page: 1,
        anchor: 3,
        author: 'Ada',
        text: 'Hello @Bob',
        created: expect.any(Number),
        resolved: false,
        replies: [
          {
            author: 'Bob',
            text: 'edited reply',
            created: expect.any(Number),
            edited: expect.any(Number),
          },
        ],
      },
      {
        id: 2,
        page: 1,
        anchor: null,
        author: 'Claude',
        text: 'x',
        created: expect.any(Number),
        resolved: false,
        replies: [],
      },
    ]);
  });

  it('reads stored and deflated entries, and a document without comments', async () => {
    const c = [{ id: 4, page: 1, anchor: 9, author: 'A', text: 't', created: 1, resolved: true }];
    for (const deflate of [true, false]) {
      expect(await readFileComments(zip('document.json', doc(c), deflate))).toEqual([
        {
          id: 4,
          page: 1,
          anchor: 9,
          author: 'A',
          text: 't',
          created: 1,
          resolved: true,
          replies: [],
        },
      ]);
    }
    expect(await readFileComments(zip('document.json', doc(undefined)))).toEqual([]);
  });

  it('skips malformed threads and replies', async () => {
    const c = [
      { id: 'x', page: 1, author: 'A', text: 't', created: 1 },
      { id: 2, page: 1, author: 'A', text: 't', created: 1e20 },
      { id: 1, page: 1, author: 'A', text: 't', created: 1, replies: [{ author: 'B' }, null] },
    ];
    expect(await readFileComments(zip('document.json', doc(c)))).toEqual([
      {
        id: 1,
        page: 1,
        anchor: null,
        author: 'A',
        text: 't',
        created: 1,
        resolved: false,
        replies: [],
      },
    ]);
  });

  it('returns null for anything that is not a figcraft document', async () => {
    expect(await readFileComments(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(await readFileComments(new Uint8Array())).toBeNull();
    expect(await readFileComments(zip('other.json', doc([])))).toBeNull();
    expect(await readFileComments(zip('document.json', '{nope'))).toBeNull();
    expect(
      await readFileComments(
        zip('document.json', JSON.stringify({ format: 'figcraft', version: 2 })),
      ),
    ).toBeNull();
    const broken = zip('document.json', doc([]));
    expect(await readFileComments(broken.subarray(0, broken.length - 30))).toBeNull();
  });
});

describe('readZip and writeZip', () => {
  const utf8 = (s: string) => new TextEncoder().encode(s);

  it("round-trips the editor's own file, entry for entry", async () => {
    const entries = await readZip(fixture);
    expect(entries?.has('document.json')).toBe(true);
    const rewritten = await writeZip(entries!);
    expect(await readZip(rewritten)).toEqual(entries);
    expect(await readFileComments(rewritten)).toEqual(await readFileComments(fixture));
  });

  it('keeps order, empty entries and UTF-8 names', async () => {
    const entries: [string, Uint8Array][] = [
      ['document.json', utf8('{"a":1}')],
      ['empty', new Uint8Array()],
      ['images/café.png', new Uint8Array(4096).map((_, i) => i % 251)],
    ];
    const zipped = await writeZip(entries);
    expect([...(await readZip(zipped))!]).toEqual(entries);
    expect(await readZipEntry(zipped, 'images/café.png')).toEqual(entries[2]![1]);
    expect(await readZipEntry(zipped, 'missing')).toBeNull();
  });

  it('writes a zip another reader accepts, CRCs included', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-zip-'));
    try {
      const file = path.join(tmp, 'x.zip');
      fs.writeFileSync(file, await writeZip([['a/b.txt', utf8('hello zip')]]));
      expect(execFileSync('unzip', ['-t', file], { encoding: 'utf8' })).toMatch(/No errors/);
      expect(execFileSync('unzip', ['-p', file, 'a/b.txt'], { encoding: 'utf8' })).toBe(
        'hello zip',
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns null for an unreadable zip', async () => {
    expect(await readZip(new Uint8Array([1, 2, 3]))).toBeNull();
    const broken = zip('document.json', doc([]));
    expect(await readZip(broken.subarray(0, broken.length - 30))).toBeNull();
  });
});
