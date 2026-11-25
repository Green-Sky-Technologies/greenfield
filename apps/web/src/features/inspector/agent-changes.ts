'use client';

/**
 * "Changed by Claude · Revert" on inspector values (Story 5.5): the values Claude set in the
 * project chat's last turn, from that reply's change records (Story 4.7, `GET /api/agent/chat`
 * → `messages[].changes`). A value is marked only while the layer still holds what Claude set,
 * so a revert, an undo or the user's own edit clears it without another read. The records are
 * read when the inspector mounts and again each time Claude's presence on the canvas ends (the
 * turn has written its records by then).
 */
import type { NodeFields, NodeId } from '@greenfield/editor-state';
import { useAgentPresence } from '@greenfield/editor-state/react';
import { useParams } from 'next/navigation';
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { same } from './fields';

/** One property Claude changed on one layer. */
export interface ClaudeChange {
  id: NodeId;
  field: string;
  before: unknown;
  after: unknown;
}

/** The last turn's changed properties, by layer and field. */
export interface ClaudeTurn {
  messageId: string;
  at: string;
  byLayer: ReadonlyMap<NodeId, ReadonlyMap<string, ClaudeChange>>;
}

/** What the inspector needs of a message view (`MessageView` in services/agent). */
export interface TurnMessage {
  id: string;
  role: string;
  createdAt: string;
  reverted: unknown;
  changes: {
    id: NodeId;
    kind: string;
    fields: { field: string; before?: unknown; after?: unknown }[];
  }[];
}

/** The chat's last reply, if it changed properties and hasn't been reverted. */
export function lastTurn(messages: readonly TurnMessage[]): ClaudeTurn | null {
  const reply = messages.findLast((m) => m.role === 'assistant');
  if (!reply || reply.reverted) return null;
  const byLayer = new Map<NodeId, Map<string, ClaudeChange>>();
  for (const c of reply.changes ?? []) {
    if (c.kind !== 'changed') continue;
    const fields = new Map<string, ClaudeChange>();
    for (const f of c.fields)
      fields.set(f.field, { id: c.id, field: f.field, before: f.before, after: f.after });
    if (fields.size) byLayer.set(c.id, fields);
  }
  return byLayer.size ? { messageId: reply.id, at: reply.createdAt, byLayer } : null;
}

/** The changes to `fields` on `nodes` that the layers still hold (current value = Claude's). */
export function currentChanges(
  turn: ClaudeTurn | null,
  nodes: readonly NodeFields[],
  fields: readonly string[],
): ClaudeChange[] {
  if (!turn) return [];
  const out: ClaudeChange[] = [];
  for (const n of nodes) {
    const mine = turn.byLayer.get(n.id);
    if (!mine) continue;
    for (const field of fields) {
      const c = mine.get(field);
      if (c && same(n[field] ?? null, c.after ?? null)) out.push(c);
    }
  }
  return out;
}

/**
 * The inspector keys a set of changes marks: each field, plus `field.key` for each key that
 * differs inside an object value (`layout.gap`, `sizing.horizontal`).
 */
export function changedKeys(changes: readonly ClaudeChange[]): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const c of changes) {
    keys.add(c.field);
    const a = c.after;
    const b = c.before;
    if (typeof a !== 'object' || a === null || Array.isArray(a)) continue;
    const prev = typeof b === 'object' && b !== null ? (b as Record<string, unknown>) : {};
    for (const [k, v] of Object.entries(a)) if (!same(v, prev[k])) keys.add(`${c.field}.${k}`);
  }
  return keys;
}

/** "just now", "5 min ago", "2 h ago", or the date. */
export function sinceText(at: string, now = Date.now()): string {
  const s = (now - Date.parse(at)) / 1000;
  if (!(s >= 0) || s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString();
}

const TurnContext = createContext<ClaudeTurn | null>(null);

/** Reads the last turn's change records for the project page this renders on. */
export function AgentChangesProvider({ children }: { children?: ReactNode }) {
  const { projectId } = useParams<{ projectId?: string }>() ?? {};
  const presence = useAgentPresence();
  const active = presence?.active ?? false;
  const [turn, setTurn] = useState<ClaudeTurn | null>(null);

  useEffect(() => {
    if (!projectId || active) return;
    const abort = new AbortController();
    fetch(`/api/agent/chat?projectId=${encodeURIComponent(projectId)}`, { signal: abort.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ messages: TurnMessage[] }>) : null))
      .then((chat) => setTurn(chat ? lastTurn(chat.messages) : null))
      .catch(() => {}); // aborted, or offline: keep what we have
    return () => abort.abort();
  }, [projectId, active]);

  return createElement(TurnContext.Provider, { value: turn }, children);
}

/** Claude's changes to `fields` that `nodes` still hold, and the keys they mark. */
export function useClaudeChanges(nodes: readonly NodeFields[], fields: readonly string[]) {
  const turn = useContext(TurnContext);
  const key = fields.join(',');
  return useMemo(() => {
    const changes = currentChanges(turn, nodes, key.split(','));
    return { changes, keys: changedKeys(changes), at: turn?.at ?? '' };
  }, [turn, nodes, key]);
}
