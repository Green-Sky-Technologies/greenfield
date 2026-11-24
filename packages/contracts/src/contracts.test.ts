import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS, jobInputs, toolsFor } from './index';

describe('contracts', () => {
  it('has no tools until Story 1.4 defines the FigCraft ones', () => {
    expect(Object.keys(AGENT_TOOLS)).toEqual([]);
    expect(toolsFor('interactive')).toEqual([]);
    expect(toolsFor('job')).toEqual([]);
  });

  it('job inputs validate', () => {
    expect(jobInputs.generate.parse({ prompt: 'A pricing page' })).toEqual({
      prompt: 'A pricing page',
      frameCount: 1,
    });
    expect(jobInputs.web_capture.safeParse({ url: 'file:///etc/passwd' }).success).toBe(false);
  });
});
