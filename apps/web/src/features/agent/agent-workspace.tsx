'use client';

/**
 * The project's editor with the minimal agent panel beside it (Story 4.2). The panel reaches the
 * editor through its iframe's control channel (`controlEditor`), so `EditorEmbed` is unchanged.
 */
import type { Editor } from '@greenfield/bridge';
import { useCallback, useRef, type ComponentProps } from 'react';
import { EditorEmbed } from '@/features/editor/editor-embed';
import { AgentPanel } from './agent-panel';
import { controlEditor } from './control-editor';

type Props = ComponentProps<typeof EditorEmbed> & { canRunAgent: boolean };

export function AgentWorkspace({ canRunAgent, ...embed }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const cached = useRef<{ iframe: HTMLIFrameElement; editor: Editor } | null>(null);
  const editor = useCallback(() => {
    const iframe = root.current?.querySelector<HTMLIFrameElement>('iframe[title="Editor"]');
    if (!iframe) return null;
    if (cached.current?.iframe !== iframe)
      cached.current = { iframe, editor: controlEditor(iframe) };
    return cached.current.editor;
  }, []);
  return (
    <div ref={root} className="flex min-h-0 flex-1">
      {canRunAgent && <AgentPanel projectId={embed.projectId} editor={editor} />}
      <EditorEmbed {...embed} />
    </div>
  );
}
