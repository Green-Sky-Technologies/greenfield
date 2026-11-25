import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  buildPrefix,
  executeTool,
  prefixBytes,
  runAgentStep,
  runAgentTurn,
  stepResults,
  ToolError,
  turnText,
  type ToolHost,
} from './index';

import { scriptedGateway, text, toolUse } from './evals/scripted';

const userTurn = (t: string): Anthropic.MessageParam => ({
  role: 'user',
  content: [{ type: 'text', text: t }],
});

/** No editor here: every contract tool call fails with a ToolError. */
const calls: string[] = [];
const host: ToolHost = {
  runtime: 'interactive',
  run: async (name) => {
    calls.push(name);
    throw new ToolError('unreachable');
  },
};

describe('cached prefix', () => {
  it('is byte-stable and has no timestamps', () => {
    const a = prefixBytes(buildPrefix('interactive'));
    expect(a).toBe(prefixBytes(buildPrefix('interactive')));
    expect(a).not.toMatch(/20\d\d-\d\d-\d\dT/);
  });

  it('sorts tools by name, marks the system prompt for 1h caching', () => {
    const p = buildPrefix('interactive');
    const names = p.tools.map((t) => t.name);
    expect(names).toEqual([...names].sort());
    expect(names).toContain('suggest_generation_job');
    expect(p.system.at(-1)!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(buildPrefix('interactive', '5m').system.at(-1)!.cache_control).toEqual({
      type: 'ephemeral',
    });
    expect(buildPrefix('job').tools.map((t) => t.name)).not.toContain('suggest_generation_job');
  });

  it('adds a file’s design system as its own cached block after the shared prompt', () => {
    const shared = buildPrefix('interactive');
    const p = buildPrefix('interactive', '1h', '<design_system name="Voirdire">…');
    expect(p.system).toHaveLength(2);
    expect(p.system[0]).toEqual(shared.system[0]);
    expect(p.system[1]).toEqual({
      type: 'text',
      text: '<design_system name="Voirdire">…',
      cache_control: { type: 'ephemeral', ttl: '1h' },
    });
    expect(p.tools).toEqual(shared.tools);
  });

  it('carries no HTML-model prompt', () => {
    expect(prefixBytes(buildPrefix('interactive'))).not.toMatch(/DesignDoc|patch_nodes|slider/);
  });
});

describe('executeTool', () => {
  it('reports unknown tools to the model without calling the host', async () => {
    const r = await executeTool(host, 'patch_nodes', {});
    expect(r).toMatchObject({ isError: true, touched: [] });
    expect(r.content).toContain('Unknown tool: patch_nodes');
    expect(calls).toEqual([]);
  });
});

describe('runAgentTurn', () => {
  it('returns tool errors to the model and keeps going', async () => {
    const { gateway, requests } = scriptedGateway([
      { content: [text('Looking.'), toolUse('tu_1', 'get_outline', {})] },
      { content: [text('Done.')] },
    ]);
    const updates: number[] = [];
    const res = await runAgentTurn({
      gateway,
      model: 'claude-sonnet-5-5',
      prefix: buildPrefix('interactive'),
      history: [],
      userTurn: userTurn('make this button larger'),
      host,
      onUpdate: (u) => updates.push(u.turns.length),
    });
    expect(res.turns.map((t) => t.role)).toEqual(['assistant', 'user', 'assistant']);
    expect(res.touched).toEqual([]);
    expect(turnText(res.turns)).toContain('Done');
    expect(updates.length).toBeGreaterThan(0);
    // The prefix is identical on every iteration (cache hits within the turn).
    expect(JSON.stringify(requests[0]!.system)).toBe(JSON.stringify(requests[1]!.system));
    expect(JSON.stringify(requests[0]!.tools)).toBe(JSON.stringify(requests[1]!.tools));
    expect(requests[0]!.cache_control).toEqual({ type: 'ephemeral' });
    const result = (requests[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1', is_error: true });
  });

  it('records a job suggestion', async () => {
    const { gateway } = scriptedGateway([
      {
        content: [
          toolUse('tu_1', 'suggest_generation_job', {
            kind: 'generate',
            prompt: 'A pricing page',
            reason: 'Needs a new frame',
          }),
        ],
      },
      { content: [text('This needs a background job.')] },
    ]);
    const res = await runAgentTurn({
      gateway,
      model: 'claude-sonnet-5-5',
      prefix: buildPrefix('interactive'),
      history: [],
      userTurn: userTurn('a pricing page please'),
      host,
    });
    expect(res.jobSuggestion).toMatchObject({ kind: 'generate' });
  });

  it('stops after maxIterations and on refusal', async () => {
    const loop = scriptedGateway([{ content: [toolUse('tu_x', 'get_outline', {})] }]);
    const res = await runAgentTurn({
      gateway: loop.gateway,
      model: 'm',
      prefix: buildPrefix('interactive'),
      history: [],
      userTurn: userTurn('x'),
      host,
      maxIterations: 3,
    });
    expect(res).toMatchObject({ iterations: 3, stopReason: 'max_iterations' });
    const refusal = scriptedGateway([{ content: [], stop: 'refusal' }]);
    const r2 = await runAgentTurn({
      gateway: refusal.gateway,
      model: 'm',
      prefix: buildPrefix('interactive'),
      history: [],
      userTurn: userTurn('x'),
      host,
    });
    expect(r2.stopReason).toBe('refusal');
  });
});

describe('runAgentStep', () => {
  it('hands valid calls to the host and answers the rest itself, in tool_use order', async () => {
    const { gateway } = scriptedGateway([
      {
        content: [
          toolUse('tu_1', 'get_outline', {}),
          toolUse('tu_2', 'get_outline', { depth: 'deep' }),
          toolUse('tu_3', 'suggest_generation_job', {
            kind: 'generate',
            prompt: 'A pricing page',
            reason: 'Needs a new frame',
          }),
          toolUse('tu_4', 'patch_nodes', {}),
        ],
      },
    ]);
    const step = await runAgentStep({
      gateway,
      model: 'm',
      prefix: buildPrefix('interactive'),
      messages: [userTurn('x')],
    });
    expect(step.kind).toBe('tools');
    expect(step.calls).toEqual([{ id: 'tu_1', name: 'get_outline', input: {} }]);
    expect(Object.keys(step.resolved).sort()).toEqual(['tu_2', 'tu_3', 'tu_4']);
    expect(step.jobSuggestion).toMatchObject({ kind: 'generate' });
    const results = stepResults(step, {
      tu_1: { type: 'tool_result', tool_use_id: 'tu_1', content: 'outline' },
    });
    expect(results.map((r) => [r.tool_use_id, r.is_error ?? false])).toEqual([
      ['tu_1', false],
      ['tu_2', true],
      ['tu_3', false],
      ['tu_4', true],
    ]);
  });

  it('ends on a reply without tool calls', async () => {
    const { gateway } = scriptedGateway([{ content: [text('Done.')] }]);
    const step = await runAgentStep({
      gateway,
      model: 'm',
      prefix: buildPrefix('interactive'),
      messages: [userTurn('x')],
    });
    expect(step).toMatchObject({ kind: 'final', calls: [], stopReason: 'end_turn' });
  });
});

describe('the v2 prompt (D25)', () => {
  it('carries the craft rules and the curated command reference, not the full catalogue', () => {
    const text = buildPrefix('interactive').system[0]!.text;
    expect(text).toContain('<craft>');
    expect(text).toContain('Every text layer you create sets fontFamily explicitly');
    expect(text).toMatch(/^node\.set\* — Set properties/m);
    expect(text).not.toContain('file.open');
    expect(text.length).toBeLessThan(12_000);
  });
});
