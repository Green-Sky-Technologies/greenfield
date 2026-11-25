import type { JobEvent } from '@greenfield/contracts';
import { describe, expect, it } from 'vitest';
import {
  activityLabel,
  applyJobEvent,
  changeRows,
  elapsed,
  formatValue,
  INITIAL_JOB,
  jobEnded,
  jobStatusLine,
  modelName,
} from './format';

describe('change rows (Story 4.7)', () => {
  it('lists each changed property with its before and after, and added or removed layers', () => {
    const rows = changeRows([
      {
        id: 4,
        name: 'Team card',
        kind: 'changed',
        frame: 2,
        fields: [
          { field: 'stroke', before: null, after: '#3ddc84' },
          { field: 'paddingLeft', before: 18, after: 16 },
        ],
      },
      { id: 9, name: 'Recommended', kind: 'added', frame: 2, fields: [] },
      { id: 11, name: '', kind: 'removed', frame: 2, fields: [] },
    ]);
    expect(rows.map((r) => `${r.layer} · ${r.what}`)).toEqual([
      'Team card · stroke none → #3ddc84',
      'Team card · padding left 18 → 16',
      'Recommended · added',
      'Layer 11 · removed',
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('keeps values short: paint lists by colour, rounded numbers, clipped text', () => {
    expect(formatValue([{ type: 'SOLID', color: '#ff9a4d' }])).toBe('#ff9a4d');
    expect(formatValue(12.3456)).toBe('12.35');
    expect(formatValue([16, 24])).toBe('16, 24');
    expect(formatValue([])).toBe('none');
    expect(formatValue('x'.repeat(40))).toHaveLength(32);
    expect(formatValue({ a: 'b'.repeat(40) })).toMatch(/…$/);
  });
});

describe('activity', () => {
  it('names an edit by its undo label and the server’s render as the self-check', () => {
    expect(activityLabel({ name: 'run_batch', input: { label: 'Tighten the cards' } })).toBe(
      'Tighten the cards',
    );
    expect(activityLabel({ name: 'render', input: {} }, true)).toBe('Check the result');
    expect(activityLabel({ name: 'get_outline', input: {} })).toBe('Read the page');
    expect(activityLabel({ name: 'some_new_tool', input: {} })).toBe('some new tool');
  });

  it('shortens model ids', () => {
    expect(modelName('claude-sonnet-5-5')).toBe('Sonnet');
    expect(modelName(null)).toBeNull();
  });
});

describe('job state from its events (Story 4.5)', () => {
  const ev = (seq: number, type: JobEvent['type'], data: Record<string, unknown>): JobEvent => ({
    seq,
    type,
    data,
    createdAt: new Date(Date.UTC(2026, 10, 24, 12, 0, seq * 10)).toISOString(),
  });

  it('follows a job from queued to its result', () => {
    const events = [
      ev(1, 'status', { status: 'queued' }),
      ev(2, 'status', { status: 'running' }),
      ev(3, 'progress', { phase: 'editing', batches: 2 }),
      ev(4, 'log', { text: 'ignored' }),
    ];
    let s = events.reduce(applyJobEvent, INITIAL_JOB);
    expect(jobStatusLine(s)).toBe('Designing · 2 edits so far');
    expect(jobEnded(s)).toBe(false);
    s = [
      ev(5, 'result', {
        summary: 'Three directions.',
        frames: [{ name: 'Pricing A' }, { name: 'Pricing B' }, { id: 3 }],
        versionId: 'v1',
      }),
      ev(6, 'status', { status: 'succeeded' }),
    ].reduce(applyJobEvent, s);
    expect(s).toMatchObject({
      status: 'succeeded',
      summary: 'Three directions.',
      frames: ['Pricing A', 'Pricing B'],
      versionId: 'v1',
    });
    expect(jobEnded(s)).toBe(true);
    expect(elapsed(s.startedAt!, s.finishedAt!)).toBe('50s');
  });

  it('keeps the sandbox’s error', () => {
    const s = [
      ev(1, 'error', { message: 'Out of time' }),
      ev(2, 'status', { status: 'failed' }),
    ].reduce(applyJobEvent, INITIAL_JOB);
    expect(s).toMatchObject({ status: 'failed', error: 'Out of time' });
    expect(jobStatusLine(s)).toBe('Failed');
  });

  it('formats minutes', () => {
    expect(elapsed('2026-11-24T12:00:00Z', '2026-11-24T12:01:52Z')).toBe('1m 52s');
  });
});
