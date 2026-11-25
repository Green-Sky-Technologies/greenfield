'use client';

import type { DesignCheckView } from '@/server/services/agent';

/**
 * Story 10.5, in the agent pane under a reply: "Checked against Voirdire · 2 fixed · 0 left",
 * what the agent fixed after the check, and anything still off the system. The agent pane
 * (W2-F) renders it for `MessageView.designCheck`.
 */
export function DesignCheckCard({ check }: { check: DesignCheckView }) {
  return (
    <section
      aria-label={`Checked against ${check.system}`}
      className="border-l-2 border-accent bg-surface px-3 py-3 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">Checked against {check.system}</p>
        <p className="shrink-0 font-mono text-xs text-accent">
          {check.fixed.length} fixed · {check.left.length} left
        </p>
      </div>
      {check.fixed.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-muted">
          {check.fixed.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {check.left.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-danger">
          {check.left.map((v) => (
            <li key={`${v.kind}:${v.field}:${v.value}`}>
              {v.kind === 'colour'
                ? `Raw ${v.field} ${v.value}`
                : `${v.field} ${v.value} off the scale`}{' '}
              on {v.layers.length} layer{v.layers.length === 1 ? '' : 's'}
              {v.suggestion ? ` (use ${v.suggestion.name})` : ''}.
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
