/**
 * The store against a real editor session (`fixtures/session.json`, recorded from the pinned
 * editor by `scripts/record-events.ts`): each step's events, then the editor's own state after
 * it. The store replays the events, with its few reads answered from the recording, and must end
 * every step where the editor is.
 */
import type { Editor, EditorEvent } from '@greenfield/bridge';
import { describe, expect, it } from 'vitest';
import session from './fixtures/session.json';
import {
  EditorStore,
  treeFromLayers,
  type EditorState,
  type NodeFields,
  type RawNode,
} from '../src';

interface Truth {
  doc: {
    id: number;
    currentPage: number;
    selection: number[];
    dirty: boolean;
    revision: number;
    history: { undo: string[]; undoDepth: number };
    pages: RawNode[];
  };
  nodes: NodeFields[];
  tool: string;
  canvasMode: boolean;
  view: { zoom: number; cx: number; cy: number; vw: number; vh: number };
}
const steps = session.steps as unknown as { step: string; events: EditorEvent[]; truth: Truth }[];

const pageTree = (t: Truth) =>
  treeFromLayers(
    t.doc.currentPage,
    t.doc.pages.find((p) => p.id === t.doc.currentPage)?.children ?? [],
  );
/** The canvas's top-left page point, as `viewport.changed` reports it. */
const viewport = ({ view: v }: Truth) => ({
  zoom: v.zoom,
  x: v.cx - v.vw / (2 * v.zoom),
  y: v.cy - v.vh / (2 * v.zoom),
});

/** The tree as rows of `id name type hidden locked`, indented by depth, for readable failures. */
function rowsOf(tree: EditorState['tree']) {
  return tree.rows.map(({ id, depth }) => {
    const n = tree.nodes.get(id)!;
    const marks = `${n.visible ? '' : ' hidden'}${n.locked ? ' locked' : ''}`;
    return `${'  '.repeat(depth)}${id} ${n.name} ${n.type}${marks}`;
  });
}

/** The recording as an `Editor`: events on demand, reads answered from the current truth. */
function replayEditor() {
  let truth: Truth = steps[0]!.truth;
  const listeners = new Set<(e: EditorEvent) => void>();
  const reads: string[] = [];
  const editor = {
    onEvent: (cb: (e: EditorEvent) => void) => (listeners.add(cb), () => listeners.delete(cb)),
    onDirty: () => () => {},
    onReady: () => () => {},
    inspect: async () => (reads.push('document.inspect'), structuredClone(truth.doc)),
    getNode: async (id: number) => (
      reads.push('node.get'),
      structuredClone(truth.nodes.find((n) => n.id === id) ?? null)
    ),
  } as unknown as Editor;
  return {
    editor,
    reads,
    play(t: Truth, events: EditorEvent[]) {
      truth = t;
      for (const e of events) for (const l of [...listeners]) l(e);
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('a recorded session through the store', () => {
  it('ends every step where the editor is', async () => {
    const store = new EditorStore();
    const replay = replayEditor();
    store.connect(replay.editor);
    for (const { step, events, truth } of steps) {
      replay.play(truth, events);
      await settle();
      const s = store.getState();
      const where = `after "${step}"`;
      expect(s.document?.id, where).toBe(truth.doc.id);
      expect(s.document?.undoDepth, where).toBe(truth.doc.history.undoDepth);
      expect(s.pages.find((p) => p.current)?.id, where).toBe(truth.doc.currentPage);
      expect(s.selection, where).toEqual(truth.doc.selection);
      expect(rowsOf(s.tree), where).toEqual(rowsOf(pageTree(truth)));
      expect([...s.nodes.values()], where).toEqual(truth.nodes);
      expect(s.tool, where).toBe(truth.tool);
      expect(s.viewport, where).toEqual(viewport(truth));
      expect(s.canvasMode, where).toBe(truth.canvasMode);
    }
  });

  it('reads the tree only on open and on a page or file change', async () => {
    const store = new EditorStore();
    const replay = replayEditor();
    store.connect(replay.editor);
    const fullReads: string[] = [];
    for (const { step, events, truth } of steps) {
      const before = replay.reads.filter((r) => r === 'document.inspect').length;
      replay.play(truth, events);
      await settle();
      const after = replay.reads.filter((r) => r === 'document.inspect').length;
      if (after > before) fullReads.push(step);
    }
    expect(fullReads).toEqual([
      'file.new',
      'add a page and switch to it',
      'back to the first page',
      'open another file',
    ]);
  });

  it('follows Claude’s presence, the canvas’s requests and the pages', async () => {
    const store = new EditorStore();
    const replay = replayEditor();
    store.connect(replay.editor);
    const seen: Record<string, Partial<EditorState>> = {};
    for (const { step, events, truth } of steps) {
      replay.play(truth, events);
      await settle();
      const { agent, request, pages } = store.getState();
      seen[step] = { agent, request, pages };
    }
    expect(seen['agent presence']!.agent).toEqual({
      name: 'Claude (agent)',
      active: true,
      layers: [2],
    });
    expect(seen['open another file']!.agent?.active).toBe(false);
    expect(seen['right-click']!.request).toEqual({
      kind: 'contextMenu',
      screen: { x: 640, y: 400 },
      data: { ids: [2] },
    });
    expect(seen['back to the first page']!.pages).toEqual([
      { id: 1, name: 'Page 1', current: true },
      { id: 7, name: 'Second', current: false },
    ]);
  });
});
