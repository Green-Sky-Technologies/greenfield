import { describe, expect, it } from 'vitest';
import {
  AGENT_TOOL_NAMES,
  AGENT_TOOLS,
  COMMAND_REFERENCE,
  agentCommandBlocked,
  commandInfo,
  stableStringify,
  toolDefinitions,
  type AgentToolName,
} from './index';

const question = {
  id: 'audience',
  prompt: 'Who is it for?',
  kind: 'single',
  options: [
    { id: 'devs', label: 'Developers' },
    { id: 'smb', label: 'Small businesses' },
  ],
  allowOther: true,
};

/** At least one valid input per tool; every one must survive a JSON round trip unchanged. */
const VALID: Record<AgentToolName, unknown[]> = {
  ask_followup: [
    { questions: [question] },
    { intro: 'Two quick questions.', questions: [question] },
  ],
  comment_thread: [{ threadId: 'c1' }, { threadId: 7, reply: 'Done: tightened the hero.' }],
  get_node: [{ id: 2 }, { id: 2, depth: 0, fields: ['name', 'layout'] }, { id: 0, outline: true }],
  get_outline: [{}, { root: 12, depth: 3 }],
  get_selection: [{}, { depth: 0, fields: ['characters'] }],
  list_commands: [{}, { query: 'align', limit: 5 }],
  render: [{}, { ids: [2, 3], scale: 0.5 }],
  run_batch: [
    { label: 'Retitle', commands: [{ command: 'text.set', params: { id: 5, characters: 'Hi' } }] },
    {
      label: 'Add card',
      commands: [
        {
          command: 'node.create',
          as: 'card',
          params: { type: 'frame', name: 'Card', props: { layout: 'vertical', gap: 12 } },
        },
        { command: 'node.create', params: { type: 'text', parent: { $ref: 'card' }, text: 'A' } },
        { command: 'node.set', params: { ids: [{ $step: 0 }], props: { cornerRadius: 16 } } },
        { command: 'node.find', as: 'found', params: { name: 'Card', root: { $ref: 'card' } } },
        { command: 'node.set', params: { id: { $ref: 'found', field: 'ids/0' }, opacity: 0.5 } },
        { command: 'node.set', params: { props: { $ref: 'card', field: 'props' } } },
      ],
    },
  ],
  suggest_generation_job: [
    { kind: 'generate', prompt: 'A pricing page with three tiers', reason: 'A new page' },
    { kind: 'alternatives', prompt: 'Other layouts', frameIds: ['2'], count: 3, reason: 'Several' },
  ],
};

/** Invalid inputs per tool, with a fragment of the expected message. */
const INVALID: Record<AgentToolName, [unknown, string][]> = {
  ask_followup: [
    [{ questions: [] }, 'questions'],
    [{ questions: [question, question] }, 'duplicate id'],
    [{ questions: [{ ...question, options: [question.options[0]] }] }, 'options'],
  ],
  comment_thread: [
    [{}, 'threadId'],
    [{ threadId: 'c1', reply: '  ' }, 'reply'],
  ],
  get_node: [
    [{}, 'id'],
    [{ id: -1 }, 'id'],
    [{ id: 1.5 }, 'id'],
    [{ id: 2, fields: ['colour'] }, 'unknown field `colour`'],
    [{ id: 2, fields: ['name'], outline: true }, 'cannot be combined'],
    [{ id: 2, extra: true }, 'extra'],
  ],
  get_outline: [
    [{ depth: 0 }, 'depth'],
    [{ root: 'n_hero' }, 'root'],
  ],
  get_selection: [
    [{ depth: 9 }, 'depth'],
    [{ fields: [] }, 'fields'],
  ],
  list_commands: [[{ limit: 500 }, 'limit']],
  render: [
    [{ ids: [] }, 'ids'],
    [{ scale: 3 }, 'scale'],
    [{ scale: 0 }, 'scale'],
  ],
  run_batch: [
    [{ commands: [{ command: 'node.set' }] }, 'label'],
    [{ label: 'x', commands: [] }, 'commands'],
    [{ label: 'x', commands: [{ command: 'nope.nope' }] }, 'unknown command `nope.nope`'],
    [{ label: 'x', commands: [{ command: 'file.save' }] }, 'not available to the agent'],
    [
      { label: 'x', commands: [{ command: 'command.batch', params: { commands: [] } }] },
      'not available',
    ],
    [{ label: 'x', commands: [{ command: 'edit.undo' }] }, 'not available'],
    [{ label: 'x', commands: [{ command: 'comment.add' }] }, 'not available'],
    [
      {
        label: 'x',
        commands: [{ command: 'node.set', params: { ids: [2], props: { colour: 'red' } } }],
      },
      'no property `colour`',
    ],
    [
      { label: 'x', commands: [{ command: 'node.set', params: { ids: [2], colour: 'red' } }] },
      'colour',
    ],
    [
      { label: 'x', commands: [{ command: 'text.set', params: { id: 2, bogus: 1 } }] },
      'has no parameter `bogus` (it takes id, characters, text)',
    ],
    [
      { label: 'x', commands: [{ command: 'node.set', params: { id: { $ref: 'later' } } }] },
      'no earlier step is named `later`',
    ],
    [
      {
        label: 'x',
        commands: [
          { command: 'node.set', params: { id: { $ref: 'b' }, opacity: 1 } },
          { command: 'node.create', as: 'b', params: { type: 'frame' } },
        ],
      },
      'no earlier step is named `b`',
    ],
    [{ label: 'x', commands: [{ command: 'node.set', params: { id: { $step: 0 } } }] }, '$step'],
    [
      { label: 'x', commands: [{ command: 'node.set', params: { id: { $ref: 'a', $step: 0 } } }] },
      'not both',
    ],
    [
      {
        label: 'x',
        commands: [
          { command: 'node.create', as: 'a', params: { type: 'frame' } },
          { command: 'node.set', params: { id: { $ref: 'a', fields: 'id' } } },
        ],
      },
      'only `field`',
    ],
    [
      {
        label: 'x',
        commands: [
          { command: 'node.create', as: 'a', params: { type: 'frame' } },
          { command: 'node.create', as: 'a', params: { type: 'frame' } },
        ],
      },
      'used twice',
    ],
    [{ label: 'x', commands: [{ command: 'node.create', as: '1bad' }] }, 'names'],
    [{ label: 'x', commands: [{ command: 'node.set', extra: 1 }] }, 'extra'],
  ],
  suggest_generation_job: [
    [{ kind: 'export', prompt: 'x', reason: 'y' }, 'kind'],
    [{ kind: 'generate', prompt: '', reason: 'y' }, 'prompt'],
    [{ kind: 'alternatives', prompt: 'x', count: 9, reason: 'y' }, 'count'],
  ],
};

const messages = (r: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (r.error?.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');

describe('tool input schemas', () => {
  it('cover every tool', () => {
    expect(Object.keys(VALID).sort()).toEqual(AGENT_TOOL_NAMES);
    expect(Object.keys(INVALID).sort()).toEqual(AGENT_TOOL_NAMES);
  });

  for (const name of AGENT_TOOL_NAMES) {
    it(`${name}: accepts valid inputs, and they round-trip through JSON`, () => {
      for (const input of VALID[name]) {
        const r = AGENT_TOOLS[name].input.safeParse(input);
        expect(r.success, messages(r)).toBe(true);
        const again = AGENT_TOOLS[name].input.parse(JSON.parse(JSON.stringify(r.data)));
        expect(again).toEqual(r.data);
      }
    });

    it(`${name}: rejects invalid inputs with a useful message`, () => {
      for (const [input, fragment] of INVALID[name]) {
        const r = AGENT_TOOLS[name].input.safeParse(input);
        expect(r.success, `${JSON.stringify(input)} should fail`).toBe(false);
        expect(messages(r)).toContain(fragment);
      }
    });
  }

  it('fills defaults', () => {
    expect(AGENT_TOOLS.get_node.input.parse({ id: 3 })).toEqual({ id: 3, depth: 1 });
    expect(AGENT_TOOLS.render.input.parse({})).toEqual({ scale: 1 });
    expect(AGENT_TOOLS.get_selection.input.parse({})).toEqual({ depth: 2 });
    expect(AGENT_TOOLS.list_commands.input.parse({})).toEqual({ limit: 40 });
  });
});

describe('tool output schemas', () => {
  it('accept what the executor returns and round-trip through JSON', () => {
    const outputs: Partial<Record<AgentToolName, unknown>> = {
      ask_followup: { outcome: 'answered', answers: [{ questionId: 'a', optionIds: ['b'] }] },
      comment_thread: { thread: 'Ada: tighten this', replied: false },
      get_node: { node: { id: 2, name: 'Card', children: [{ id: 3, childCount: 2 }] } },
      get_outline: { page: 1, outline: { id: 1, type: 'PAGE', children: [] } },
      get_selection: { page: 1, selection: [] },
      list_commands: {
        total: 1,
        commands: [{ id: 'node.set', label: 'Set', params: '{ids?}', undoable: true }],
      },
      render: { ids: null, width: 1, height: 1 },
      run_batch: {
        label: 'x',
        results: [{ id: 4 }],
        changes: { added: [4], removed: [], changed: [{ id: 2, fields: ['children'] }] },
      },
      suggest_generation_job: { status: 'offered' },
    };
    for (const name of AGENT_TOOL_NAMES) {
      const out = AGENT_TOOLS[name].output.parse(outputs[name]);
      expect(AGENT_TOOLS[name].output.parse(JSON.parse(JSON.stringify(out)))).toEqual(out);
    }
    expect(AGENT_TOOLS.get_node.output.safeParse({ node: { name: 'no id' } }).success).toBe(false);
    expect(AGENT_TOOLS.run_batch.output.safeParse({ label: 'x', results: [] }).success).toBe(false);
  });
});

describe('command policy', () => {
  it('knows the pinned commands and blocks app-level ones', () => {
    for (const c of COMMAND_REFERENCE) {
      expect(commandInfo(c), c).toBeDefined();
      expect(agentCommandBlocked(c)).toBeNull();
    }
    expect(agentCommandBlocked('view.zoomIn')).toMatch(/not available|unknown/);
    expect(agentCommandBlocked('node.set', new Set(['text.set']))).toBe(
      '`node.set` is not allowed here',
    );
  });
});

describe('tool definitions', () => {
  it('are sorted, byte-stable and match the snapshot', async () => {
    for (const runtime of ['interactive', 'job'] as const) {
      const defs = toolDefinitions(runtime);
      expect(defs.map((d) => d.name)).toEqual([...defs.map((d) => d.name)].sort());
      for (const d of defs) {
        expect(d.input_schema.type).toBe('object');
        expect(d.description.length).toBeGreaterThan(40);
        // Keys are sorted at every level.
        expect(JSON.stringify(d.input_schema)).toBe(stableStringify(d.input_schema));
      }
    }
    const bytes = JSON.stringify(toolDefinitions('interactive'), null, 2) + '\n';
    expect(JSON.stringify(toolDefinitions('interactive'), null, 2) + '\n').toBe(bytes);
    expect(bytes).not.toMatch(/20\d\d-\d\d-\d\dT/);
    await expect(bytes).toMatchFileSnapshot('./__snapshots__/tool-definitions.json');
    expect(toolDefinitions('job').map((d) => d.name)).not.toContain('ask_followup');
  });

  it('describe references and the one-undo-step rule for run_batch', () => {
    const def = toolDefinitions('interactive').find((d) => d.name === 'run_batch')!;
    expect(def.description).toContain('ONE undo step');
    expect(def.description).toContain('{"$ref": name}');
    expect(def.input_schema).toMatchObject({
      required: ['label', 'commands'],
      additionalProperties: false,
    });
  });
});
