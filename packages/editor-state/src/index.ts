/**
 * `@greenfield/editor-state` (Story 5.6): the editor state the panels read, fed only by the
 * bridge's events and written only through the bridge. React hooks: `@greenfield/editor-state/react`.
 */
export { fromEditorEvent } from './events';
export { Gesture, type PreviewCommand } from './gesture';
export { INITIAL_STATE, reduce } from './reducer';
export { EditorStore } from './store';
export {
  diffTrees,
  EMPTY_TREE,
  patchTree,
  treeFromLayers,
  visibleRows,
  type TreePatch,
} from './tree';
export type * from './types';
