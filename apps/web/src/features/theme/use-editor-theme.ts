'use client';

import { EditorHiddenError, EditorNotReadyError, type Editor } from '@greenfield/bridge';
import { useEffect } from 'react';
import { currentPreference, THEME_EVENT, type ThemePreference } from './theme';

const COMMAND = {
  system: 'view.themeSystem',
  dark: 'view.themeDark',
  light: 'view.themeLight',
} as const satisfies Record<ThemePreference, string>;

export function useEditorTheme(editor: Editor | null): void {
  useEffect(() => {
    if (!editor) return;
    const apply = () => {
      editor.execute(COMMAND[currentPreference()], {}).catch((e: unknown) => {
        if (!(e instanceof EditorHiddenError || e instanceof EditorNotReadyError)) throw e;
      });
    };
    const offReady = editor.onReady(apply);
    window.addEventListener(THEME_EVENT, apply);
    return () => {
      offReady();
      window.removeEventListener(THEME_EVENT, apply);
    };
  }, [editor]);
}
