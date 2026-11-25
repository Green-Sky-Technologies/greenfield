/**
 * `@greenfield/editor-state/react`: the store as hooks. Each hook subscribes to one slice and
 * re-renders only when that slice is a different object (the reducer keeps unchanged slices).
 *
 *   <EditorStateProvider store={store}>…</EditorStateProvider>
 *   const selection = useSelection();
 *   const node = useNode(selection[0]);
 *   const scrub = useGesture('Change X');
 *   scrub.preview([{ command: 'node.set', params: { ids: [id], x } }]); … scrub.commit();
 */
import type { NodeId } from '@greenfield/bridge';
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { Gesture, PreviewCommand } from './gesture';
import { INITIAL_STATE } from './reducer';
import type { EditorStore } from './store';
import type { EditorState } from './types';

const StoreContext = createContext<EditorStore | null>(null);

export function EditorStateProvider({
  store,
  children,
}: {
  store: EditorStore;
  children?: ReactNode;
}) {
  return createElement(StoreContext.Provider, { value: store }, children);
}

/** The store itself, for writes (`run`, `batch`, `requestDone`). */
export function useEditorStore(): EditorStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useEditorStore: no <EditorStateProvider> above this component');
  return store;
}

/** One slice of the state. `select` must return a slice of it, not a new object. */
export function useEditorState<T>(select: (s: EditorState) => T): T {
  const store = useEditorStore();
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getState()),
    () => select(INITIAL_STATE),
  );
}

export const useSelection = () => useEditorState((s) => s.selection);
/** A selected layer's full fields (undefined for a layer that isn't selected). */
export const useNode = (id: NodeId | null | undefined) =>
  useEditorState((s) => (id == null ? undefined : s.nodes.get(id)));
/** The page tree and its row model (`rows`), for the layers list. */
export const usePageTree = () => useEditorState((s) => s.tree);
/** One layer of the tree (a layers row). */
export const useTreeNode = (id: NodeId) => useEditorState((s) => s.tree.nodes.get(id));
export const usePages = () => useEditorState((s) => s.pages);
/** The current page's prototype flows. */
export const useFlows = () => useEditorState((s) => s.flows);
export const useTool = () => useEditorState((s) => s.tool);
export const useViewport = () => useEditorState((s) => s.viewport);
export const useTextEditing = () => useEditorState((s) => s.textEditing);
export const useAgentPresence = () => useEditorState((s) => s.agent);
/** An open drag or gesture on the canvas (a scrub must not begin over the canvas's own). */
export const useInteraction = () => useEditorState((s) => s.interaction);
export const useDocument = () => useEditorState((s) => s.document);
export const useCanvasMode = () => useEditorState((s) => s.canvasMode);
export const useUiRequest = () => useEditorState((s) => s.request);

export interface GestureHandle {
  /** Show these commands' result from where the gesture began (begins it on first use). */
  preview(commands: readonly PreviewCommand[]): void;
  /** One undo step for everything previewed. */
  commit(): Promise<void>;
  /** Back to where it began. */
  cancel(): Promise<void>;
}

/** A gesture for a scrub or drag: a new one starts with the first preview after each end. */
export function useGesture(label: string): GestureHandle {
  const store = useEditorStore();
  return useMemo(() => {
    let current: Gesture | null = null;
    const end = (how: 'commit' | 'cancel') => {
      const g = current;
      current = null;
      return g ? g[how]() : Promise.resolve();
    };
    return {
      preview(commands) {
        current ??= store.gesture(label);
        current.preview(commands);
      },
      commit: () => end('commit'),
      cancel: () => end('cancel'),
    };
  }, [store, label]);
}
