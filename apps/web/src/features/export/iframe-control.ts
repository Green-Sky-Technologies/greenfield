/**
 * The bridge's control client over an editor iframe that something else loaded. `EditorEmbed`
 * still speaks the host protocol itself; once it moves to `createBridge`, pass that `Editor` to
 * `ExportMenu` instead and delete this file.
 */
import { ControlClient, platformFromUserAgent, type FigcraftApi } from '@greenfield/bridge';

export function iframeControl(iframe: HTMLIFrameElement): ControlClient {
  return new ControlClient({
    api: () => {
      const w = iframe.contentWindow as (Window & { figcraft?: FigcraftApi }) | null;
      return w?.figcraft ?? 'the editor is still loading';
    },
    isHidden: () => document.visibilityState === 'hidden',
    platform: () => platformFromUserAgent(navigator.userAgent),
  });
}
