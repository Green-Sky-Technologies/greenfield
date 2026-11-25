/**
 * `@greenfield/bridge`: the only way app code talks to the editor (SPEC §1, D21).
 *
 * - `createBridge({ iframe })`: the real editor (FigCraft in host + control mode) as an `Editor`.
 * - `@greenfield/bridge/mock`: `MockEditor`, the same interface in memory, for unit tests.
 * - `@greenfield/bridge/file`: `readFileComments`, a saved document's comment threads (no editor).
 * - `@greenfield/bridge/playwright`: fixtures that drive the real editor from Playwright tests.
 */
export { createBridge, editorSrc, type BridgeOptions } from './bridge';
export {
  ChangeDetector,
  DIFF_FIELDS,
  diffSnapshots,
  flatten,
  type NodeRecord,
} from './change-detect';
export {
  addComment,
  deleteComment,
  listComments,
  replyToComment,
  resolveComment,
  type AddCommentInput,
  type CommentMention,
  type CommentMessage,
  type CommentReaction,
  type CommentThread,
  type ListCommentsOptions,
} from './comments';
export {
  isRef,
  ref,
  step,
  type BatchStep,
  type CommandId,
  type CommandParams,
  type NamedRef,
  type Ref,
  type StepRef,
  type WithRefs,
} from './commands';
export { ControlClient, DEFAULT_TIMEOUT_MS, type FigcraftApi } from './control';
export {
  BridgeError,
  CommandError,
  EditorFailedError,
  EditorHiddenError,
  EditorNotReadyError,
  EditorTimeoutError,
  NoDocumentError,
  type BridgeErrorCode,
} from './errors';
export {
  COMMAND_COUNT,
  COMMANDS,
  COMMANDS_HASH,
  EDITOR_RELEASE_SHA256,
  EDITOR_VERSION,
  NODE_FIELDS,
  NODE_SET_PROPS,
  type CommandParamsMap,
  type NodeField,
  type NodeProps,
} from './generated/commands';
export {
  editorEvent,
  type EditorEvent,
  type EditorEventMap,
  type EditorEventName,
  type NodeChange,
  type NodePlace,
} from './events';
export { HostChannel, type HostChannelOptions } from './host';
export { editorHasFocus, focusEditor, interceptEditorKeys, isEditableTarget } from './keyboard';
export { base64ToBytes, bytesToBase64, pngSize } from './png';
export {
  isSaveShortcut,
  platformFromUserAgent,
  saveChord,
  saveKey,
  shortcutKey,
  type KeyPlatform,
} from './platform';
export type * from './types';
