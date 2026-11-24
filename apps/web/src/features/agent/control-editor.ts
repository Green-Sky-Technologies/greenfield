/**
 * An `Editor` over the embedded editor's control channel (`window.figcraft`) only.
 *
 * `EditorEmbed` still speaks the host-message protocol itself (open, save, dirty), so the agent
 * can't own the iframe through `createBridge`. It only needs control calls; the host-message
 * members here are inert. Once the embed moves to `createBridge` (Epic 5), pass that bridge
 * instead and delete this file.
 */
import {
  ControlClient,
  EditorNotReadyError,
  platformFromUserAgent,
  type Editor,
  type FigcraftApi,
} from '@greenfield/bridge';

export function controlEditor(iframe: HTMLIFrameElement): Editor {
  const win = iframe.ownerDocument.defaultView!;
  const isHidden = () => win.document.visibilityState === 'hidden';
  const control = new ControlClient({
    api: () =>
      (iframe.contentWindow as (Window & { figcraft?: FigcraftApi }) | null)?.figcraft ??
      'the editor is still loading',
    isHidden,
    platform: () => platformFromUserAgent(win.navigator.userAgent),
  });
  const notHere = (what: string) => () => {
    throw new EditorNotReadyError(what, 'the editor embed owns host messages');
  };
  const noop = () => () => {};
  return {
    get isReady() {
      return !!(iframe.contentWindow as (Window & { figcraft?: unknown }) | null)?.figcraft;
    },
    ready: () => Promise.reject(new EditorNotReadyError('ready', 'use the editor embed')),
    onReady: noop,
    onDirty: noop,
    onSave: noop,
    onFailed: noop,
    onChange: noop,
    open: notHere('open'),
    detectChanges: async () => null,
    dispose: () => {},
    save: (o) => control.save(o),
    execute: (command, params, o) => control.execute(command, params, o),
    batch: (steps, o) => control.batch(steps, o),
    batchContinue: (steps, o) => control.batchContinue(steps, o),
    inspect: (o, c) => control.inspect(o, c),
    getNode: (id, o, c) => control.getNode(id, o, c),
    render: (o, c) => control.render(o, c),
    commands: (c) => control.commands(c),
    request: (method, params, o) => control.request(method, params, o),
  };
}
