/**
 * The store against a real editor session (`fixtures/session.json`, recorded from the pinned
 * editor by `scripts/record-events.ts`): each step's events, then the editor's own state after
 * it. Two replays:
 *
 * 1. Today's ids-only events through `EditorStore`, with its reads answered from the recording
 *    (the editor as it was after the step): the store ends each step where the editor is.
 * 2. The same session as payload events (what lane W1-A adds), through the reducer alone with no
 *    reads except the full one on open and on a page or file change.
 */
import type { Editor, EditorEvent } from '@greenfield/bridge';
import { describe, expect, it } from 'vitest';
import session from './fixtures/session.json';
import {
  diffTrees,
  EditorStore,
  fromEditorEvent,
  INITIAL_STATE,
  reduce,
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

/** The editor's tree as rows of `depth name type visible locked`, for readable failures. */
function rowsOf(tree: EditorState['tree']) {
  return tree.rows.map(({ id, depth }) => {
    const n = tree.nodes.get(id)!;
    return `${'  '.repeat(depth)}${id} ${n.name} ${n.type}${n.visible ? '' : ' hidden'}${n.locked ? ' locked' : ''}`;
  });
}

/** The recording as an `Editor`: events on demand, reads answered from the current truth. */
function replayEditor() {
  let truth: Truth = steps[0]!.truth;
  const listeners = new Set<(e: EditorEvent) => void>();
  const calls: string[] = [];
  const editor = {
    onEvent: (cb: (e: EditorEvent) => void) => (listeners.add(cb), () => listeners.delete(cb)),
    onDirty: () => () => {},
    onReady: () => () => {},
    inspect: async () => (calls.push('inspect'), structuredClone(truth.doc)),
    getNode: async (id: number) => (
      calls.push('node.get'),
      structuredClone(truth.nodes.find((n) => n.id === id) ?? null)
    ),
    request: async (method: string) => {
      calls.push(method);
      return { status: { tool: truth.tool } };
    },
    execute: async (command: string) => {
      calls.push(command);
      return truth.view;
    },
  } as unknown as Editor;
  return {
    editor,
    calls,
    play(t: Truth, events: EditorEvent[]) {
      truth = t;
      for (const e of events) for (const l of [...listeners]) l(e);
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('a recorded session through the store (ids-only events + reads)', () => {
  it('ends every step where the editor is', async () => {
    const store = new EditorStore();
    const replay = replayEditor();
    store.connect(replay.editor);
    for (const { step, events, truth } of steps) {
      replay.play(truth, events);
      for (let i = 0; i < 5; i++) await settle();
      const s = store.getState();
      const where = `after "${step}"`;
      expect(s.document?.id, where).toBe(truth.doc.id);
      expect(s.document?.undoDepth, where).toBe(truth.doc.history.undoDepth);
      expect(s.selection, where).toEqual(truth.doc.selection);
      expect(rowsOf(s.tree), where).toEqual(rowsOf(pageTree(truth)));
      expect(s.pages.find((p) => p.current)?.id, where).toBe(truth.doc.currentPage);
      expect([...s.nodes.values()], where).toEqual(truth.nodes);
      expect(s.canvasMode, where).toBe(truth.canvasMode);
      // Tool and zoom have no events yet: the store reads them after other events only.
      if (events.length) {
        expect(s.tool, where).toBe(truth.tool);
        expect(s.viewport, where).toEqual(viewport(truth));
      }
    }
  });

  it('reads the whole tree only on open and on a page or file change', async () => {
    const store = new EditorStore();
    const replay = replayEditor();
    store.connect(replay.editor);
    const fullReads: string[] = [];
    for (const { step, events, truth } of steps) {
      const before = store.getState();
      replay.play(truth, events);
      for (let i = 0; i < 5; i++) await settle();
      const after = store.getState();
      if (after.document?.id !== before.document?.id) fullReads.push(`${step}: file`);
      else if (after.pages.find((p) => p.current)?.id !== before.pages.find((p) => p.current)?.id)
        fullReads.push(`${step}: page`);
    }
    expect(fullReads).toEqual([
      'file.new: file',
      'add a page and switch to it: page',
      'back to the first page: page',
      'open another file: file',
    ]);
  });

  it('follows Claude’s presence and the canvas’s requests', async () => {
    const store = new EditorStore();
    const replay = replayEditor();
    store.connect(replay.editor);
    const seen: Record<string, Partial<EditorState>> = {};
    for (const { step, events, truth } of steps) {
      replay.play(truth, events);
      await settle();
      const { agent, request } = store.getState();
      seen[step] = { agent, request };
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
  });
});

describe('the same session as payload events (Story 2.3 payloads, reducer only)', () => {
  it('patches the tree to where the editor is, with no reads between opens', () => {
    let state = INITIAL_STATE;
    let prev: Truth | null = null;
    for (const { step, events, truth } of steps) {
      const where = `after "${step}"`;
      const opened =
        !prev || prev.doc.id !== truth.doc.id || prev.doc.currentPage !== truth.doc.currentPage;
      for (const e of events) {
        const a = fromEditorEvent(e);
        if (!a) continue;
        if (a.type === 'document.changed' && prev && !opened) {
          // What the editor will send: the structure change and the changed layers' fields (here
          // the selected layers' full fields stand in for "the fields that changed").
          const patch = diffTrees(pageTree(prev), pageTree(truth));
          Object.assign(a, patch, { nodes: [...patch.nodes, ...truth.nodes] });
        }
        if (a.type === 'selection.changed')
          a.nodes = truth.nodes.filter((n) => a.ids.includes(n.id));
        state = reduce(state, a);
      }
      if (opened) {
        state = reduce(state, {
          type: 'document.loaded',
          document: {
            id: truth.doc.id,
            revision: truth.doc.revision,
            undoDepth: truth.doc.history.undoDepth,
            dirty: truth.doc.dirty,
          },
          pages: truth.doc.pages.map((p) => ({
            id: p.id,
            name: p.name ?? '',
            current: p.id === truth.doc.currentPage,
          })),
          layers: truth.doc.pages.find((p) => p.id === truth.doc.currentPage)?.children ?? [],
          selection: truth.doc.selection,
        });
        state = reduce(state, { type: 'nodes.loaded', nodes: truth.nodes });
      }
      expect(rowsOf(state.tree), where).toEqual(rowsOf(pageTree(truth)));
      expect(state.selection, where).toEqual(truth.doc.selection);
      expect([...state.nodes.values()], where).toEqual(truth.nodes);
      prev = truth;
    }
  });
});
