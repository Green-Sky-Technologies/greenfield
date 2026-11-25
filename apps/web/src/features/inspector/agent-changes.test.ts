import { describe, expect, it } from 'vitest';
import {
  changedKeys,
  currentChanges,
  lastTurn,
  sinceText,
  type TurnMessage,
} from './agent-changes';

const reply = (over: Partial<TurnMessage> = {}): TurnMessage => ({
  id: 'm2',
  role: 'assistant',
  createdAt: '2026-11-24T10:00:00.000Z',
  reverted: null,
  changes: [
    {
      id: 7,
      kind: 'changed',
      fields: [
        {
          field: 'fills',
          before: [{ type: 'solid', color: '#14150F' }],
          after: [{ type: 'solid', color: '#3FD67F' }],
        },
        {
          field: 'layout',
          before: { mode: 'vertical', gap: 14, padding: [10, 18, 10, 18] },
          after: { mode: 'vertical', gap: 16, padding: [10, 18, 10, 18] },
        },
      ],
    },
    { id: 9, kind: 'added', fields: [] },
  ],
  ...over,
});
const user = { id: 'm1', role: 'user', createdAt: '', reverted: null, changes: [] };

describe('changed by Claude', () => {
  it("reads the chat's last reply, unless it was reverted or changed nothing", () => {
    const turn = lastTurn([user, reply()]);
    expect(turn?.messageId).toBe('m2');
    expect([...turn!.byLayer.keys()]).toEqual([7]);
    expect(lastTurn([user, reply({ reverted: { how: 'undo' } })])).toBeNull();
    expect(lastTurn([reply(), { ...reply({ id: 'm3', changes: [] }) }])).toBeNull();
    expect(lastTurn([user])).toBeNull();
  });

  it('marks a value only while the layer still holds what Claude set', () => {
    const turn = lastTurn([reply()]);
    const now = { id: 7, fills: [{ color: '#3FD67F', type: 'solid' }] }; // keys in another order
    expect(currentChanges(turn, [now], ['fills']).map((c) => c.field)).toEqual(['fills']);
    const reverted = { id: 7, fills: [{ type: 'solid', color: '#14150F' }] };
    expect(currentChanges(turn, [reverted], ['fills'])).toEqual([]);
    expect(currentChanges(turn, [{ ...now, id: 8 }], ['fills'])).toEqual([]);
  });

  it('marks the keys that changed inside an object value', () => {
    const turn = lastTurn([reply()]);
    const node = { id: 7, layout: { mode: 'vertical', gap: 16, padding: [10, 18, 10, 18] } };
    expect([...changedKeys(currentChanges(turn, [node], ['layout']))]).toEqual([
      'layout',
      'layout.gap',
    ]);
  });

  it('says when', () => {
    const at = '2026-11-24T10:00:00.000Z';
    const t = Date.parse(at);
    expect(sinceText(at, t + 20_000)).toBe('just now');
    expect(sinceText(at, t + 5 * 60_000)).toBe('5 min ago');
    expect(sinceText(at, t + 2 * 3600_000)).toBe('2 h ago');
  });
});
