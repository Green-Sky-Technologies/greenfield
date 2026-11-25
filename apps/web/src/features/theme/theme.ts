/**
 * App theme preference (Story 5.3). The preference lives in a cookie so the server can render
 * `<html data-theme>` with no flash: `dark` and `light` are explicit; `system` renders as
 * `data-theme="system"` and CSS (`prefers-color-scheme`, see globals.css) picks the tokens, so
 * the server never has to guess the OS setting. Dark is the default.
 */
export const THEME_COOKIE = 'gf-theme';
export const THEME_EVENT = 'gf-theme-change';
const ONE_YEAR_S = 60 * 60 * 24 * 365;

export type ThemePreference = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'dark', 'light'];

export function parseThemePreference(value: string | undefined | null): ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark' ? value : 'dark';
}

/** The theme in effect for a preference; `prefersLight` is the OS setting (for `system`). */
export function resolveTheme(pref: ThemePreference, prefersLight: boolean): ResolvedTheme {
  return pref === 'system' ? (prefersLight ? 'light' : 'dark') : pref;
}

export function systemPrefersLight(): boolean {
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

/** What `<html data-theme>` currently says, as a preference (browser only). */
export function currentPreference(): ThemePreference {
  return parseThemePreference(document.documentElement.dataset.theme);
}

/** Store the preference, apply it to the page now, and tell listeners (the editor sync). */
export function setThemePreference(pref: ThemePreference): void {
  document.cookie = `${THEME_COOKIE}=${pref}; path=/; max-age=${ONE_YEAR_S}; SameSite=Lax`;
  document.documentElement.dataset.theme = pref;
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: pref }));
}
