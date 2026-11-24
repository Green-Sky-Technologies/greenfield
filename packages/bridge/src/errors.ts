/**
 * Typed errors for every way a bridge call can fail. All extend `BridgeError`, so callers can
 * `catch (e) { if (e instanceof BridgeError) … }` and switch on `e.code`.
 */
export type BridgeErrorCode =
  'hidden' | 'not_ready' | 'no_document' | 'command' | 'timeout' | 'failed';

export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  constructor(code: BridgeErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/**
 * The editor's tab is hidden (`document.visibilityState === 'hidden'`). Every `window.figcraft`
 * call waits for an editor frame and hidden tabs draw none, so the call would hang for 30 s; the
 * bridge refuses it up front instead. Retry once the tab is visible again (Story 0.4 (a)).
 */
export class EditorHiddenError extends BridgeError {
  constructor(method: string) {
    super('hidden', `The editor tab is hidden, so \`${method}\` was not sent. Retry when visible.`);
  }
}

/** The editor hasn't posted `figcraft:ready` yet (or has been disposed or failed to start). */
export class EditorNotReadyError extends BridgeError {
  constructor(method: string, reason = 'the editor is not ready') {
    super('not_ready', `\`${method}\` failed: ${reason}.`);
  }
}

/**
 * No document is open: host mode starts on the home screen until the host sends `open` (or
 * `file.new` runs). `document.inspect` then answers `{documents: 0}`.
 */
export class NoDocumentError extends BridgeError {
  constructor(method: string) {
    super('no_document', `\`${method}\` failed: no document is open.`);
  }
}

/** The editor rejected a call: an unknown command, bad parameters, a missing node, … */
export class CommandError extends BridgeError {
  /** The control method (`engine.execute`, `document.inspect`, `ui.render`, …). */
  readonly method: string;
  /** The command id for `engine.execute` calls (including `command.batch`). */
  readonly command: string | undefined;
  /** The editor's own message, verbatim. */
  readonly editorMessage: string;
  constructor(method: string, command: string | undefined, editorMessage: string) {
    super('command', `${command ?? method}: ${editorMessage}`);
    this.method = method;
    this.command = command;
    this.editorMessage = editorMessage;
  }
}

/**
 * No answer in time. Either the bridge's own deadline passed, or the editor gave up after its
 * 30 s (`craft-web-api`: the request is dropped unrun if it hadn't started). A call that had
 * started can't be stopped and may still take effect, so check the document before retrying a
 * mutation.
 */
export class EditorTimeoutError extends BridgeError {
  readonly method: string;
  readonly timeoutMs: number | undefined;
  constructor(method: string, timeoutMs?: number, editorMessage?: string) {
    super(
      'timeout',
      editorMessage
        ? `\`${method}\` timed out in the editor: ${editorMessage}`
        : `\`${method}\` got no answer within ${timeoutMs} ms.`,
    );
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

/** The editor reported `figcraft:failed` (no WebGPU or WebGL2, for example). */
export class EditorFailedError extends BridgeError {
  constructor(reason: string) {
    super('failed', `The editor failed to start: ${reason}`);
  }
}

/** craft-web-api's rejection after 30 s without a frame ("figcraft did not answer … within 30 s"). */
const EDITOR_TIMEOUT = /did not answer/i;

/** Turn whatever the editor rejected with into a typed error. */
export function toBridgeError(
  method: string,
  command: string | undefined,
  e: unknown,
): BridgeError {
  if (e instanceof BridgeError) return e;
  const message = e instanceof Error ? e.message : String(e);
  if (EDITOR_TIMEOUT.test(message)) return new EditorTimeoutError(method, undefined, message);
  return new CommandError(method, command, message);
}
