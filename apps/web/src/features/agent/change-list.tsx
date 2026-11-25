'use client';

/**
 * What a finished turn changed, layer by layer (Story 4.7, design 02/4.7): a row per property
 * (before → after), "Show on canvas" (select the layers and zoom to them, Story 5.5) and
 * "Undo all". Ember marks Claude's changes (D24).
 */
import { useEditorStore } from '@greenfield/editor-state/react';
import { useState } from 'react';
import type { MessageView } from '@/server/services/agent';
import { changeRows } from './format';

const SHOWN = 12;

interface Props {
  reply: MessageView;
  onUndo: () => Promise<number>;
}

export function ChangeList({ reply, onUndo }: Props) {
  const store = useEditorStore();
  const [all, setAll] = useState(false);
  const [lost, setLost] = useState(0);
  const rows = changeRows(reply.changes);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, SHOWN);
  const steps = reply.undoLabels.length;

  const show = async () => {
    await store.run('select.set', { ids: reply.showOnCanvas });
    await store.run('view.zoomSelection', {});
  };

  return (
    <section aria-label="Changes by Claude" className="mt-2">
      <ul className={reply.reverted ? 'opacity-50' : undefined}>
        {shown.map((r) => (
          <li
            key={r.key}
            data-testid="change-row"
            className="flex items-baseline gap-2 border-b border-border py-2 text-[13px] last:border-b-0"
          >
            <span aria-hidden className="size-1.5 shrink-0 -translate-y-0.5 bg-agent" />
            <span className="min-w-0">
              {r.layer} · {r.what}
            </span>
          </li>
        ))}
      </ul>
      {rows.length > SHOWN && !all && (
        <button type="button" className="btn-link text-xs text-muted" onClick={() => setAll(true)}>
          {rows.length - SHOWN} more
        </button>
      )}
      <div className="mt-2 flex gap-3 text-[13px] text-user">
        {reply.showOnCanvas.length > 0 && !reply.reverted && (
          <button type="button" className="btn-link px-0 decoration-current" onClick={show}>
            Show on canvas
          </button>
        )}
        {!reply.reverted && (
          <button
            type="button"
            className="btn-link px-0 decoration-current"
            onClick={async () => setLost(await onUndo())}
          >
            Undo all
          </button>
        )}
      </div>
      <p data-testid="change-summary" className="mt-1 text-xs text-muted">
        {reply.reverted
          ? 'Undone.'
          : `${rows.length} change${rows.length === 1 ? '' : 's'} · ${
              steps === 1 ? 'one undo step' : `${steps} undo steps`
            }`}
        {lost > 0 && ` ${lost} removed layer${lost === 1 ? '' : 's'} couldn’t be brought back.`}
      </p>
    </section>
  );
}
