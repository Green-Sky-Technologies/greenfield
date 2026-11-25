export const THEME_COOKIE = 'gf-theme';
export const THEME_EVENT = 'gf-theme-change';
const ONE_YEAR_S = 60 * 60 * 24 * 365;

export type ThemePreference = 'system' | 'dark' | 'light';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'dark', 'light'];

export function parseThemePreference(value: string | undefined | null): ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark' ? value : 'dark';
}

export function currentPreference(): ThemePreference {
  return parseThemePreference(document.documentElement.dataset.theme);
}

export function setThemePreference(pref: ThemePreference): void {
  document.cookie = `${THEME_COOKIE}=${pref}; path=/; max-age=${ONE_YEAR_S}; SameSite=Lax`;
  document.documentElement.dataset.theme = pref;
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: pref }));
}
