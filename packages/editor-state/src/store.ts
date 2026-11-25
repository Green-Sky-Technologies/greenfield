/**
 * `EditorStore`: the one store the panels read (Story 5.6). Fed only by the bridge's events (and
 * the full reads on open in `reads.ts`), written only through the bridge: `run`, `batch` and
 * `gesture`.
 *
 *   const store = new EditorStore();
 *   const disconnect = store.connect(editor);  // when the bridge exists
 *   store.subscribe(() => render(store.getState()));
 *   await store.run('node.set', { ids: [7], name: 'Hero' });
 */
import {
  EditorNotReadyError,
  type BatchOptions,
  type BatchStep,
  type CommandId,
  type CommandParams,
  type Editor,
  type Unsubscribe,
} from '@greenfield/bridge';
import { fromEditorEvent } from './events';
import { Gesture } from './gesture';
import { EditorReads } from './reads';
import { INITIAL_STATE, reduce } from './reducer';
import type { EditorAction, EditorState } from './types';

export class EditorStore {
  private state: EditorState;
  private readonly listeners = new Set<() => void>();
  private editor: Editor | null = null;

  constructor(initial: Partial<EditorState> = {}) {
    this.state = { ...INITIAL_STATE, ...initial };
  }

  readonly getState = (): EditorState => this.state;

  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Apply one action; listeners run only when the state changed. */
  dispatch(action: EditorAction): void {
    const next = reduce(this.state, action);
    if (next === this.state) return;
    this.state = next;
    for (const l of [...this.listeners]) l();
  }

  /**
   * Follow `editor`: its events and dirty flag, and a full read now (if a document is open) and
   * whenever another file or page opens. Returns the disconnect.
   */
  connect(editor: Editor): Unsubscribe {
    this.editor = editor;
    const reads = new EditorReads(editor, this);
    const offs = [
      editor.onEvent((e) => {
        const action = fromEditorEvent(e);
        if (!action) return;
        this.dispatch(action);
        reads.after(action);
      }),
      editor.onDirty((dirty) => this.dispatch({ type: 'dirty', dirty })),
      editor.onReady(() => reads.load()),
    ];
    return () => {
      for (const off of offs) off();
      if (this.editor === editor) this.editor = null;
    };
  }

  private connected(method: string): Editor {
    if (!this.editor) throw new EditorNotReadyError(method, 'the store has no editor');
    return this.editor;
  }

  /** Run one command. */
  run<C extends CommandId>(command: C, params?: CommandParams<C>): Promise<unknown> {
    return this.connected(command).execute(command, params);
  }

  /** Several commands as one undo step. */
  batch(steps: readonly BatchStep[], opts?: BatchOptions): Promise<unknown[]> {
    return this.connected('command.batch').batch(steps, opts);
  }

  /** A drag or scrub as one undo step (see `Gesture`). */
  gesture(label: string): Gesture {
    return new Gesture(this.connected('edit.begin'), label);
  }

  /** The host has answered the canvas's open request (menu closed, picker done). */
  requestDone(): void {
    this.dispatch({ type: 'request.done' });
  }
}
