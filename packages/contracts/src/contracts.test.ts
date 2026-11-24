import { describe, expect, it } from 'vitest';
import { AGENT_TOOL_NAMES, AGENT_TOOLS, jobInputs, toolsFor } from './index';

describe('contracts', () => {
  it('defines the Story 1.4 tools, sorted, the same for both runtimes', () => {
    expect(AGENT_TOOL_NAMES).toEqual([
      'ask_followup',
      'comment_thread',
      'get_node',
      'get_outline',
      'get_selection',
      'list_commands',
      'render',
      'run_batch',
      'suggest_generation_job',
    ]);
    for (const [key, def] of Object.entries(AGENT_TOOLS)) expect(def.name).toBe(key);
    expect(toolsFor('interactive').map((t) => t.name)).toEqual(AGENT_TOOL_NAMES);
    // Jobs get the same editor tools; only the control tools (which talk to a person) differ.
    const job = toolsFor('job');
    expect(job.map((t) => t.name)).toEqual(
      AGENT_TOOL_NAMES.filter((n) => AGENT_TOOLS[n].kind !== 'control'),
    );
    expect(job.every((t) => toolsFor('interactive').includes(t))).toBe(true);
    expect(AGENT_TOOLS.run_batch.kind).toBe('mutate');
  });

  it('job inputs validate', () => {
    expect(jobInputs.generate.parse({ prompt: 'A pricing page' })).toEqual({
      prompt: 'A pricing page',
      frameCount: 1,
    });
    expect(jobInputs.web_capture.safeParse({ url: 'file:///etc/passwd' }).success).toBe(false);
  });
});
