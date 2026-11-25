'use client';

/**
 * The top bar's tools (Story 5.1): the canvas's tool from `tool.changed` (`useTool`), set with
 * the editor's `tool.*` commands. Choosing one hands the keyboard back to the canvas, where the
 * tool is used; the letters work there too (the editor's own bindings).
 */
import { focusEditor, type CommandId } from '@greenfield/bridge';
import { useEditorStore, useTool } from '@greenfield/editor-state/react';

const TOOLS: { id: string; label: string; key: string; d: string }[] = [
  { id: 'move', label: 'Move', key: 'V', d: 'M3 2l9 5-4 1.2L6.5 12z' },
  { id: 'frame', label: 'Frame', key: 'F', d: 'M5 1v14M11 1v14M1 5h14M1 11h14' },
  { id: 'rectangle', label: 'Rectangle', key: 'R', d: 'M2.5 3.5h11v9h-11z' },
  { id: 'pen', label: 'Pen', key: 'P', d: 'M8 2l5 7-5 5-5-5zM8 2v6' },
  { id: 'text', label: 'Text', key: 'T', d: 'M3 3h10M8 3v10' },
  {
    id: 'hand',
    label: 'Hand',
    key: 'H',
    d: 'M5 8V3.5a1 1 0 012 0V7M7 7V2.5a1 1 0 012 0V7M9 7V3.5a1 1 0 012 0V9c0 3-2 5-4.5 5S3 12 3 10V7.5a1 1 0 012 0',
  },
];

export function ToolRow() {
  const tool = useTool();
  const store = useEditorStore();
  const choose = (id: string) => {
    store.run(`tool.${id}` as CommandId, {}).catch(() => {}); // no document yet: nothing to draw on
    const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Design canvas"]');
    if (frame) focusEditor(frame);
  };
  return (
    <div
      role="group"
      aria-label="Tools"
      data-testid="tool-row"
      data-tool={tool ?? ''}
      className="flex items-center gap-0.5"
    >
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-label={`${t.label} (${t.key})`}
          aria-pressed={tool === t.id}
          title={`${t.label} (${t.key})`}
          onClick={() => choose(t.id)}
          className="shell-focus flex size-8 items-center justify-center text-text hover:bg-surface-2 aria-pressed:bg-user aria-pressed:text-user-ink"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden
          >
            <path d={t.d} />
          </svg>
        </button>
      ))}
      <span aria-hidden className="mx-1.5 h-5 w-px bg-border" />
    </div>
  );
}
