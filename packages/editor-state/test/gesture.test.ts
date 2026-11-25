import { CommandError, type Editor } from '@greenfield/bridge';
import { describe, expect, it } from 'vitest';
import { Gesture } from '../src';

/** An editor whose replies the test releases one at a time. */
function slowEditor(opts: { openGesture?: boolean } = {}) {
  let open = opts.openGesture ?? false;
  const log: string[] = [];
  const waiting: (() => void)[] = [];
  const editor = {
    execute: (
      command: string,
      params: { label?: string; commands?: { params: { x: number } }[] },
    ) => {
      if (command === 'edit.begin') {
        if (open)
          return Promise.reject(
            new CommandError('engine.execute', command, 'a gesture is already in progress'),
          );
        open = true;
      }
      if (command === 'edit.commit' || command === 'edit.cancel') open = false;
      log.push(command === 'edit.preview' ? `preview x=${params.commands![0]!.params.x}` : command);
      if (command !== 'edit.preview') return Promise.resolve(null);
      return new Promise<null>((resolve) => waiting.push(() => resolve(null)));
    },
  } as unknown as Editor;
  return { editor, log, release: () => waiting.shift()?.(), pending: () => waiting.length };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const move = (x: number) => [{ command: 'node.set' as const, params: { ids: [2], x } }];

describe('Gesture', () => {
  it('keeps two previews in flight and lets the newest replace the waiting one', async () => {
    const { editor, log, release, pending } = slowEditor();
    const g = new Gesture(editor, 'Change X');
    g.preview(move(0)); // replaced while edit.begin runs
    g.preview(move(1));
    await tick();
    for (const x of [2, 3, 4, 5]) g.preview(move(x));
    await tick();
    expect(log).toEqual(['edit.begin', 'preview x=1', 'preview x=2']);
    expect(pending()).toBe(2);
    release();
    await tick();
    expect(log.at(-1)).toBe('preview x=5'); // 3 and 4 were replaced while waiting
    const done = g.commit();
    release();
    release();
    await done;
    expect(log).toEqual(['edit.begin', 'preview x=1', 'preview x=2', 'preview x=5', 'edit.commit']);
  });

  it('cancels a stale gesture before it begins', async () => {
    const { editor, log, release } = slowEditor({ openGesture: true });
    const g = new Gesture(editor, 'Change X');
    g.preview(move(1));
    await tick();
    expect(log).toEqual(['edit.cancel', 'edit.begin', 'preview x=1']);
    release();
    await g.commit();
    expect(log.at(-1)).toBe('edit.commit');
  });

  it('cancel drops what is waiting, and a gesture with no preview sends nothing', async () => {
    const { editor, log, release } = slowEditor();
    const g = new Gesture(editor, 'Change X');
    g.preview(move(1));
    await tick();
    for (const x of [2, 3]) g.preview(move(x));
    await tick();
    const done = g.cancel();
    release();
    release();
    await done;
    expect(log).toEqual(['edit.begin', 'preview x=1', 'preview x=2', 'edit.cancel']);
    g.preview(move(9)); // ended: ignored
    const unused = new Gesture(editor, 'Nothing');
    await unused.commit();
    expect(log.at(-1)).toBe('edit.cancel');
  });
});
