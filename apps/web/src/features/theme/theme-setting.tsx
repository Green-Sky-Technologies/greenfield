'use client';

import { useState } from 'react';
import {
  currentPreference,
  setThemePreference,
  THEME_PREFERENCES,
  type ThemePreference,
} from './theme';

const LABELS: Record<ThemePreference, string> = { system: 'System', dark: 'Dark', light: 'Light' };

/** System / Dark / Light. Applies at once and is remembered in a cookie. */
export function ThemeSetting({ initial }: { initial: ThemePreference }) {
  const [pref, setPref] = useState(initial);
  const choose = (p: ThemePreference) => {
    setThemePreference(p);
    setPref(currentPreference());
  };
  return (
    <fieldset>
      <legend className="label">Theme</legend>
      <div role="radiogroup" aria-label="Theme" className="inline-flex border border-border">
        {THEME_PREFERENCES.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={pref === p}
            onClick={() => choose(p)}
            className={`shell-focus px-4 py-1.5 text-sm ${pref === p ? 'bg-user font-medium text-user-ink' : 'text-muted hover:bg-surface-2 hover:text-text'}`}
          >
            {LABELS[p]}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-muted">
        System follows your device. The design editor changes with it.
      </p>
    </fieldset>
  );
}
