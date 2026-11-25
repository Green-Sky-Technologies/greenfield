'use client';

import type { Editor } from '@greenfield/bridge';
import { useEffect } from 'react';
import { currentPreference, resolveTheme, systemPrefersLight, THEME_EVENT } from './theme';

/**
 * Keeps the embedded editor's theme in step with the app's (Story 5.3): once when the editor is
 * ready, when the preference changes, and, for System, when the OS setting changes. Goes through
 * the bridge; the editor's own colours are the fork's concern (Story 2.1).
 */
export function useEditorTheme(editor: Editor | null): void {
  useEffect(() => {
    if (!editor) return;
    const apply = () => {
      const theme = resolveTheme(currentPreference(), systemPrefersLight());
      editor.execute(theme === 'light' ? 'view.themeLight' : 'view.themeDark', {}).catch(() => {}); // the editor may be hidden or gone; the next change retries
    };
    const offReady = editor.onReady(apply); // runs at once if the editor is already ready
    const media = window.matchMedia('(prefers-color-scheme: light)');
    window.addEventListener(THEME_EVENT, apply);
    media.addEventListener('change', apply);
    return () => {
      offReady();
      window.removeEventListener(THEME_EVENT, apply);
      media.removeEventListener('change', apply);
    };
  }, [editor]);
}
