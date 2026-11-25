/**
 * What the store reads from the editor (no timers: ADR 0005, condition 2).
 *
 * - `load()`: the whole page tree and the selected layers, on open, on a file or page change, and
 *   when a `document.changed` says `resync`.
 * - The ids-only adapter (`fillIn`, `readTree`, `readUi`): today's editor sends `selection.changed
 *   {ids}` and `document.changed {revision, undoDepth}` without the fields and structure the
 *   reducer applies, and no `tool.changed`, `viewport.changed` or `text.editing`. Until the fork's
 *   payloads land (lane W1-A), each such event costs a read here, turned into the payload the
 *   editor will send (`diffTrees`). It switches itself off at the first event with a payload;
 *   delete it once the pinned editor sends them.
 *
 * Each read is latest-wins: one in flight, and a request during it runs one more afterwards.
 */
import { BridgeError, type Editor, type NodeField } from '@greenfield/bridge';
import { hasDocumentPatch, hasSelectionFields } from './events';
import { diffTrees, treeFromLayers } from './tree';
import type { EditorAction, EditorState, NodeFields, PageSummary, RawNode } from './types';

/** What a layers row needs. */
const TREE_FIELDS = ['name', 'type', 'visible', 'locked'] as const satisfies readonly NodeField[];
/** `document.inspect`'s maximum depth. */
const MAX_DEPTH = 64;
/** Selected layers read in full on open; past this a big selection shows ids only. */
const MAX_SELECTED_READS = 50;

interface Host {
  getState(): EditorState;
  dispatch(action: EditorAction): void;
}

function latest(run: () => Promise<void>): () => void {
  let busy = false;
  let again = false;
  const go = (): void => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    run()
      .catch((e: unknown) => {
        // Hidden tab, no document yet, a reload: the next event asks again.
        if (!(e instanceof BridgeError)) throw e;
      })
      .finally(() => {
        busy = false;
        if (again) {
          again = false;
          go();
        }
      });
  };
  return go;
}

const currentPage = (s: EditorState) => s.pages.find((p) => p.current)?.id;

export class EditorReads {
  /** The editor sends payloads: the ids-only adapter is off. */
  private payloads = false;

  constructor(
    private readonly editor: Editor,
    private readonly host: Host,
  ) {}

  /** Read the document, its current page and the selected layers in full. */
  readonly load = latest(async () => {
    const info = await this.editor.inspect({ depth: MAX_DEPTH, fields: TREE_FIELDS });
    const current = info.pages.find((p) => p.id === info.currentPage);
    const pages: PageSummary[] = info.pages.map((p) => ({
      id: p.id,
      name: typeof p.name === 'string' ? p.name : `Page ${p.id}`,
      current: p.id === info.currentPage,
    }));
    this.host.dispatch({
      type: 'document.loaded',
      document: {
        id: info.id,
        revision: typeof info.revision === 'number' ? info.revision : 0,
        undoDepth: info.history.undoDepth ?? info.history.undo.length,
        dirty: info.dirty,
      },
      pages,
      layers: (current?.children ?? []) as RawNode[],
      selection: info.selection,
    });
    this.readSelection();
    if (!this.payloads) this.readUi();
  });

  /** After the reducer applied `action`: read what it didn't carry. */
  after(action: EditorAction): void {
    if (
      hasSelectionFields(action) ||
      hasDocumentPatch(action) ||
      (action.type === 'document.changed' && action.resync) ||
      action.type === 'tool.changed'
    )
      this.payloads = true;
    // Switching canvas mode resizes the canvas: no `viewport.changed` for it yet.
    if (action.type === 'canvas.mode' && !this.payloads) this.readUi();
    if (action.type !== 'selection.changed' && action.type !== 'document.changed') return;
    const state = this.host.getState();
    const stale =
      !state.document ||
      action.document !== state.document.id ||
      (action.type === 'selection.changed' && action.page !== currentPage(state)) ||
      (action.type === 'document.changed' && action.resync);
    if (stale) return this.load();
    if (!this.payloads) this.fillIn(action);
  }

  /** After the store ran `command` itself. */
  afterRun(command: string): void {
    if (!this.payloads && /^(tool|view)\./.test(command)) this.readUi();
  }

  private fillIn(action: EditorAction): void {
    if (action.type === 'document.changed') this.readTree();
    this.readSelection();
    this.readUi();
  }

  private readonly readSelection = latest(async () => {
    const ids = this.host.getState().selection.slice(0, MAX_SELECTED_READS);
    if (!ids.length) return;
    const nodes = await Promise.all(ids.map((id) => this.editor.getNode(id, { depth: 0 })));
    this.host.dispatch({
      type: 'nodes.loaded',
      nodes: nodes.filter((n) => n !== null) as NodeFields[],
    });
  });

  private readonly readTree = latest(async () => {
    const info = await this.editor.inspect({ depth: MAX_DEPTH, fields: TREE_FIELDS });
    const state = this.host.getState();
    const doc = state.document;
    if (!doc || info.id !== doc.id || info.currentPage !== currentPage(state)) return this.load();
    const page = info.pages.find((p) => p.id === info.currentPage);
    const read = treeFromLayers(info.currentPage, (page?.children ?? []) as RawNode[]);
    this.host.dispatch({
      type: 'document.changed',
      document: doc.id,
      revision: doc.revision,
      undoDepth: doc.undoDepth,
      ...diffTrees(state.tree, read),
    });
  });

  private readonly readUi = latest(async () => {
    const [ui, view, info] = await Promise.all([
      this.editor.request('ui.inspect') as Promise<{ status?: { tool?: unknown } }>,
      this.editor.execute('view.get', {}) as Promise<Record<string, unknown>>,
      this.editor.inspect({ depth: 0, fields: [] }),
    ]);
    const tool = ui.status?.tool;
    if (typeof tool === 'string') this.host.dispatch({ type: 'tool.changed', tool });
    const { zoom, cx, cy, vw, vh } = view;
    if ([zoom, cx, cy, vw, vh].every((v) => typeof v === 'number')) {
      const z = zoom as number;
      this.host.dispatch({
        type: 'viewport.changed',
        zoom: z,
        x: (cx as number) - (vw as number) / (2 * z),
        y: (cy as number) - (vh as number) / (2 * z),
      });
    }
    const edit = info.textEdit as { id?: unknown } | null | undefined;
    this.host.dispatch({ type: 'text.editing', id: typeof edit?.id === 'number' ? edit.id : null });
  });
}
