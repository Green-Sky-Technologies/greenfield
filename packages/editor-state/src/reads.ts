/**
 * The only reads the store makes (no timers: ADR 0005, condition 2): the document, its current
 * page's tree and the selected layers in full, on open, on a file or page change, and when a
 * `document.changed` says `resync` (the editor couldn't patch). Everything else comes from the
 * editor's events. Latest-wins: one read in flight, and a request during it runs one more after.
 */
import { BridgeError, type Editor, type NodeField } from '@greenfield/bridge';
import type { EditorAction, EditorState, NodeFields, PageSummary, RawNode } from './types';

/** What a layers row needs. */
const TREE_FIELDS = ['name', 'type', 'visible', 'locked'] as const satisfies readonly NodeField[];
/** `document.inspect`'s maximum depth. */
const MAX_DEPTH = 64;
/** Selected layers read on open; the editor's next `selection.changed` carries them all. */
const MAX_SELECTED_READS = 50;

interface Host {
  getState(): EditorState;
  dispatch(action: EditorAction): void;
}

export class EditorReads {
  private busy = false;
  private again = false;

  constructor(
    private readonly editor: Editor,
    private readonly host: Host,
  ) {}

  /** After the reducer applied `action`: read in full if it can't be patched. */
  after(action: EditorAction): void {
    if (action.type !== 'selection.changed' && action.type !== 'document.changed') return;
    const state = this.host.getState();
    const stale =
      !state.document ||
      action.document !== state.document.id ||
      (action.type === 'selection.changed' &&
        action.page !== state.pages.find((p) => p.current)?.id) ||
      (action.type === 'document.changed' && action.resync === true);
    if (stale) this.load();
  }

  /** Read the document, its current page and the selected layers. */
  load(): void {
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    this.read()
      .catch((e: unknown) => {
        // Hidden tab, no document yet, a reload: the next event asks again.
        if (!(e instanceof BridgeError)) throw e;
      })
      .finally(() => {
        this.busy = false;
        if (this.again) {
          this.again = false;
          this.load();
        }
      });
  }

  private async read(): Promise<void> {
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
    const selected = await Promise.all(
      info.selection
        .slice(0, MAX_SELECTED_READS)
        .map((id) => this.editor.getNode(id, { depth: 0 })),
    );
    this.host.dispatch({
      type: 'nodes.loaded',
      nodes: selected.filter((n) => n !== null) as NodeFields[],
    });
  }
}
