import { describe, expect, it } from 'vitest';
import { askPrompt } from './ask-claude';
import { placeBeside } from './composer';

describe('askPrompt', () => {
  it('leads with the request, then the thread it came from', () => {
    const p = askPrompt(4, '# Greenfield feedback\n- Make it blue\n', 'Use the brand green');
    expect(p.startsWith('Use the brand green\n\nThis came from comment thread 4')).toBe(true);
    expect(p).toContain('- Make it blue');
    expect(p).toContain('comment_thread');
  });

  it('asks Claude to do what the thread says when there is no request', () => {
    expect(askPrompt(1, 'brief', '  ')).toMatch(/^Do what this comment thread asks\./);
  });
});

describe('placeBeside', () => {
  const frame = { left: 300, top: 80 };
  const view = { width: 1440, height: 900 };

  it('puts the box right of the point, in page pixels', () => {
    expect(placeBeside({ x: 100, y: 200 }, frame, view)).toEqual({ left: 416, top: 264 });
  });

  it('flips left of the point near the right edge, and stays inside the window', () => {
    const at = placeBeside({ x: 1100, y: 880 }, frame, view);
    expect(at.left + 328).toBeLessThanOrEqual(300 + 1100);
    expect(at.top + 216).toBeLessThanOrEqual(900);
  });

  it('keeps the box in the window when the point is scrolled out of view', () => {
    expect(placeBeside({ x: 5000, y: -400 }, frame, view)).toEqual({ left: 1096, top: 16 });
    expect(placeBeside({ x: -900, y: 4000 }, frame, view)).toEqual({ left: 16, top: 668 });
  });
});
