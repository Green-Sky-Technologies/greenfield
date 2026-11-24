import { afterEach, describe, expect, it, vi } from 'vitest';
import { diffSnapshots, flatten } from '../src/change-detect';
import { MockEditor } from '../src/mock';
import type { ChangeSet } from '../src/types';

afterEach(() => vi.useRealTimers());

/** The mock's private state, for edits the gate can't see. */
const internals = (ed: MockEditor) =>
  ed as unknown as {
    doc: { selection: number[]; pages: { children: { props: Record<string, unknown> }[] }[] };
  };

describe('diff', () => {
  it('reports added, removed and changed fields (structure included)', () => {
    const a = flatten({
      children: [
        { id: 2, name: 'A', x: 0, children: [{ id: 3, name: 'B', fills: [{ color: '#FFF' }] }] },
        { id: 4, name: 'C' },
      ],
    });
    const b = flatten({
      children: [
        { id: 2, name: 'A2', x: 0, children: [] },
        { id: 3, name: 'B', fills: [{ color: '#000' }] },
        { id: 5, name: 'D' },
      ],
    });
    expect(diffSnapshots(a, b)).toEqual({
      added: [5],
      removed: [4],
      changed: [
        { id: 2, fields: ['name', 'children'] },
        { id: 3, fields: ['fills', 'parent'] },
      ],
    });
  });
});

describe('ChangeDetector (through MockEditor)', () => {
  it('detectChanges diffs against the last snapshot and counts control edits', async () => {
    const ed = new MockEditor();
    expect(await ed.detectChanges()).toBeNull(); // baseline
    const { id } = (await ed.execute('node.create', { type: 'frame' })) as { id: number };
    let c = (await ed.detectChanges())!;
    expect(c.added).toEqual([id]);
    expect(c.controlEdits).toBe(1);
    expect(c.meta).toMatchObject({ history: true, selection: true, dirty: true });

    await ed.userExecute('node.set', { ids: [id], props: { name: 'Hand made', x: 10 } });
    c = (await ed.detectChanges())!;
    expect(c.changed).toEqual([{ id, fields: ['name', 'x'] }]);
    expect(c.controlEdits).toBe(0); // a person's edit
    expect(await ed.detectChanges()).toBeNull();
  });

  it('a document switch resets the snapshot', async () => {
    const ed = new MockEditor();
    await ed.execute('node.create', { type: 'frame' });
    await ed.detectChanges();
    await ed.execute('file.new', {});
    const c = (await ed.detectChanges())!;
    expect(c.meta.document).toBe(true);
    expect(c).toMatchObject({ added: [], removed: [], changed: [] });
  });

  it('polls the gate, diffs after a change (debounced), and reports selection-only changes', async () => {
    vi.useFakeTimers();
    const ed = new MockEditor({
      changes: { gateIntervalMs: 100, debounceMs: 50, backstopMs: 60_000 },
    });
    const seen: ChangeSet[] = [];
    const inspect = vi.spyOn(ed, 'inspect');
    const off = ed.onChange((c) => seen.push(c));
    await vi.advanceTimersByTimeAsync(0); // first tick: baseline (gate + full)
    const { id } = (await ed.execute('node.create', { type: 'frame' })) as { id: number };
    await vi.advanceTimersByTimeAsync(100); // the gate sees it
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(50); // debounced full diff
    expect(seen).toHaveLength(1);
    expect(seen[0]!.added).toEqual([id]);

    // Selection only: reported from the gate, with no full inspect.
    const fullCalls = () => inspect.mock.calls.filter(([o]) => o?.depth === 64).length;
    const before = fullCalls();
    internals(ed).doc.selection = [];
    await vi.advanceTimersByTimeAsync(100);
    expect(seen.at(-1)).toMatchObject({ added: [], changed: [], meta: { selection: true } });
    expect(fullCalls()).toBe(before);
    off();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fullCalls()).toBe(before); // stopped with the last subscriber
  });

  it('pauses while hidden and resumes when shown', async () => {
    vi.useFakeTimers();
    const ed = new MockEditor({ changes: { gateIntervalMs: 100, debounceMs: 10 } });
    const inspect = vi.spyOn(ed, 'inspect');
    const seen: ChangeSet[] = [];
    ed.onChange((c) => seen.push(c));
    await vi.advanceTimersByTimeAsync(250);
    const n = inspect.mock.calls.length;
    expect(n).toBeGreaterThan(1);
    ed.setHidden(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(inspect.mock.calls.length).toBe(n); // no polling while hidden
    ed.setHidden(false);
    await ed.execute('node.create', { type: 'frame' });
    await vi.advanceTimersByTimeAsync(150);
    expect(inspect.mock.calls.length).toBeGreaterThan(n);
    expect(seen.some((c) => c.added.length === 1)).toBe(true);
  });

  it('the backstop catches what the gate misses', async () => {
    vi.useFakeTimers();
    const ed = new MockEditor({
      changes: { gateIntervalMs: 100, debounceMs: 10, backstopMs: 1000 },
    });
    const { id } = (await ed.execute('node.create', { type: 'frame' })) as { id: number };
    const seen: ChangeSet[] = [];
    ed.onChange((c) => seen.push(c));
    await vi.advanceTimersByTimeAsync(0); // baseline
    // Change a layer without touching what the gate keys on (as an undo followed by an edit
    // with the same label does in the real editor).
    internals(ed).doc.pages[0]!.children[0]!.props.name = 'Sneaky';
    await vi.advanceTimersByTimeAsync(500);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(600);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.changed).toEqual([{ id, fields: ['name'] }]);
  });
});
