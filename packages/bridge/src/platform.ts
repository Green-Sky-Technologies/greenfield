/**
 * Keyboard platform. FigCraft (egui) decides Mac vs not from the browser's user agent, and maps
 * shortcuts accordingly: Save is Cmd+S on a Mac and Ctrl+S elsewhere (`ui.key {ctrl: true}` on a
 * Mac is the separate Control key and saves nothing). Story 0.1 found this in WebKit.
 */
export type KeyPlatform = 'mac' | 'other';

/** egui's `OperatingSystem::from_user_agent`, reduced to what matters for shortcuts. */
export function platformFromUserAgent(userAgent: string): KeyPlatform {
  if (/Android/.test(userAgent)) return 'other';
  if (/like Mac/.test(userAgent)) return 'mac'; // iOS / iPadOS: Cmd as well
  if (/Win/.test(userAgent)) return 'other';
  if (/Mac/.test(userAgent)) return 'mac';
  return 'other';
}

/** `ui.key` params for a modified shortcut: `cmd` on a Mac, `ctrl` elsewhere. */
export function shortcutKey(
  key: string,
  platform: KeyPlatform,
): { key: string; cmd?: true; ctrl?: true } {
  return platform === 'mac' ? { key, cmd: true } : { key, ctrl: true };
}

/** The Save shortcut as `ui.key` params. */
export const saveKey = (platform: KeyPlatform) => shortcutKey('S', platform);

/** The Save shortcut as a Playwright / DOM key chord (`Meta+S` or `Control+S`). */
export const saveChord = (platform: KeyPlatform) => (platform === 'mac' ? 'Meta+S' : 'Control+S');

/**
 * Whether a host-page `keydown` is the Save shortcut, so the shell can route it to the editor
 * (`bridge.save()`) instead of the browser's "Save page".
 */
export function isSaveShortcut(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  platform: KeyPlatform,
): boolean {
  if (e.key.toLowerCase() !== 's' || e.altKey || e.shiftKey) return false;
  return platform === 'mac' ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}
