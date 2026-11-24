/**
 * Comment threads in the real editor (Story 6.1): a comment pinned to a layer follows it when the
 * layer moves, before and after a save and reopen, and the saved file carries the threads the
 * server mirrors (`readFileComments`).
 */
import {
  addComment,
  deleteComment,
  listComments,
  replyToComment,
  resolveComment,
  type CommentThread,
} from '../src/index';
import { readFileComments } from '../src/file';
import { expect, openEditor, test } from '../src/playwright/index';

test.use({ editorOptions: { author: 'Ada' } });

const pin = (threads: CommentThread[], id: number) => {
  const t = threads.find((c) => c.id === id);
  if (!t) throw new Error(`no thread ${id}`);
  return t;
};

test('a comment pinned to a layer follows it; threads round-trip through the file', async ({
  editor,
  page,
}) => {
  await editor.execute('file.new', {});
  await expect
    .poll(async () => (await editor.inspect({ depth: 0, fields: [] })).pages.length)
    .toBe(1);
  const frame = (await editor.execute('node.create', {
    type: 'frame',
    name: 'Card',
    x: 100,
    y: 100,
    width: 200,
    height: 120,
  })) as { id: number };
  const box = (await editor.execute('node.create', {
    type: 'rectangle',
    name: 'Heading',
    parent: frame.id,
    x: 20,
    y: 20,
    width: 50,
    height: 50,
  })) as { id: number };

  const pinned = await addComment(editor, {
    x: 130,
    y: 130,
    text: 'Tighten this @Bob',
    anchor: box.id,
  });
  const loose = await addComment(editor, { x: 600, y: 600, text: 'Free-floating' });
  const doomed = await addComment(editor, { x: 700, y: 700, text: 'Delete me' });
  expect(await replyToComment(editor, pinned.id, 'On it', { author: 'Bob' })).toEqual({ reply: 0 });
  await resolveComment(editor, loose.id);
  await deleteComment(editor, doomed.id);

  let threads = await listComments(editor);
  expect(threads.map((t) => t.id).sort()).toEqual([pinned.id, loose.id].sort());
  expect(pin(threads, pinned.id)).toMatchObject({
    anchor: box.id,
    frame: frame.id,
    author: 'Ada',
    x: 130,
    y: 130,
    resolved: false,
    replies: [{ author: 'Bob', text: 'On it' }],
    mentions: [{ name: 'Bob' }],
  });
  expect(pin(threads, loose.id)).toMatchObject({ anchor: null, resolved: true, x: 600, y: 600 });

  // Move the frame (the anchor's parent), then the anchor itself: the pin follows both moves;
  // the page-pinned thread stays put.
  await editor.execute('node.set', { ids: [frame.id], props: { x: 400, y: 300 } });
  threads = await listComments(editor);
  expect(pin(threads, pinned.id)).toMatchObject({ x: 430, y: 330 });
  await editor.execute('node.set', { ids: [box.id], props: { x: 100 } });
  threads = await listComments(editor);
  expect(pin(threads, pinned.id)).toMatchObject({ x: 510, y: 330 });
  expect(pin(threads, loose.id)).toMatchObject({ x: 600, y: 600 });

  // Save: the file holds the threads, anchored by layer id.
  const saved = await editor.nextSave(() => editor.pressSave());
  const fileThreads = await readFileComments(saved.bytes);
  expect(fileThreads).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: pinned.id,
        anchor: box.id,
        author: 'Ada',
        text: 'Tighten this @Bob',
        resolved: false,
        replies: [expect.objectContaining({ author: 'Bob', text: 'On it' })],
      }),
      expect.objectContaining({ id: loose.id, anchor: null, resolved: true }),
    ]),
  );
  expect(fileThreads).toHaveLength(2);

  // Reopen the saved file in a fresh editor and move the layer again: still pinned.
  const again = await openEditor(page, { author: 'Ada' });
  await again.openAndWait('Comments.figcraft', saved.bytes);
  // `open` applies on a later frame: until then there's no document.
  await expect
    .poll(() =>
      listComments(again).then(
        (t) => t.length,
        (e: unknown) => String(e),
      ),
    )
    .toBe(2);
  expect(pin(await listComments(again), pinned.id)).toMatchObject({
    anchor: box.id,
    x: 510,
    y: 330,
  });
  await again.execute('node.set', { ids: [frame.id], props: { x: 0, y: 0 } });
  expect(pin(await listComments(again), pinned.id)).toMatchObject({ x: 110, y: 30 });
});
