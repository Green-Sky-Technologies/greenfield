'use client';

/**
 * The top bar's tools (move, frame, shapes, pen, text, hand, comment). Stub for lane W2-D
 * (Story 5.1): shows the active tool from `useTool` and sets it with `run('tool.*')`.
 */
import { useEditorStore, useTool } from '@greenfield/editor-state/react';

const TOOLS = [
  ['move', 'Move'],
  ['frame', 'Frame'],
  ['rectangle', 'Rectangle'],
  ['text', 'Text'],
] as const;

export function ToolRow() {
  const tool = useTool();
  const store = useEditorStore();
  return (
    <div
      role="group"
      aria-label="Tools"
      data-testid="tool-row"
      data-tool={tool ?? ''}
      className="flex"
    >
      {TOOLS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-label={label}
          aria-pressed={tool === id}
          onClick={() => store.run(`tool.${id}`, {}).catch(() => {})}
          className="shell-focus h-8 px-2 text-xs text-muted hover:text-text aria-pressed:bg-user aria-pressed:text-user-ink"
        >
          {label[0]}
        </button>
      ))}
    </div>
  );
}
