import {
  EditorTimeoutError,
  type CommandId,
  type CommandParams,
  type DocumentInfo,
  type InspectOptions,
} from '@greenfield/bridge';
import { MockEditor } from '@greenfield/bridge/mock';
import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS, executeTool, SUGGEST_JOB_RESULT, type ToolOutcome } from './index';

async function setup() {
  const editor = new MockEditor();
  const [card, title] = (await editor.batch(
    [
      {
        command: 'node.create',
        as: 'card',
        params: { type: 'frame', name: 'Card', select: false },
      },
      {
        command: 'node.create',
        params: { type: 'text', parent: { $ref: 'card' }, text: 'Hello', select: false },
      },
    ],
    { label: 'Setup' },
  )) as { id: number }[];
  return { editor, card: card!.id, title: title!.id };
}

const ok = (r: ToolOutcome) => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r;
};
const err = (r: ToolOutcome) => {
  if (r.ok) throw new Error('expected an error');
  return r;
};
const json = (r: ToolOutcome) => JSON.parse((r.content.at(-1) as { text: string }).text);

describe('executeTool: reads', () => {
  it('get_selection returns the selected layers (empty when nothing is selected)', async () => {
    const { editor, card, title } = await setup();
    expect(ok(await executeTool('get_selection', {}, editor)).output).toEqual({
      page: 1,
      selection: [],
    });
    await editor.execute('select.set', { ids: [title] });
    const r = ok(await executeTool('get_selection', { fields: ['name', 'characters'] }, editor));
    expect(r.output).toEqual({
      page: 1,
      selection: [{ id: title, name: 'Hello', characters: 'Hello' }],
    });
    expect(json(r)).toEqual(r.output);
    expect(r.touched).toEqual([]);
    expect(card).toBeLessThan(title);
  });

  it('get_outline outlines the page or a subtree', async () => {
    const { editor, card, title } = await setup();
    const page = ok(await executeTool('get_outline', {}, editor)).output as {
      outline: { children: unknown[] };
    };
    expect(page.outline.children).toEqual([
      {
        id: card,
        name: 'Card',
        type: 'FRAME',
        visible: true,
        children: [{ id: title, name: 'Hello', type: 'TEXT', characters: 'Hello', visible: true }],
      },
    ]);
    const sub = ok(await executeTool('get_outline', { root: card, depth: 1 }, editor));
    expect(sub.output).toMatchObject({ page: 1, outline: { id: card, children: [{ id: title }] } });
    expect(err(await executeTool('get_outline', { root: 999 }, editor)).error).toEqual({
      kind: 'not_found',
      message: 'No layer 999',
    });
  });

  it('get_node reads one layer, or reports a missing one', async () => {
    const { editor, card, title } = await setup();
    const r = ok(await executeTool('get_node', { id: card, depth: 0, fields: ['name'] }, editor));
    expect(r.output).toEqual({ node: { id: card, name: 'Card', childCount: 1 } });
    expect(ok(await executeTool('get_node', { id: card }, editor)).output).toMatchObject({
      node: { id: card, children: [{ id: title, characters: 'Hello' }] },
    });
    expect(err(await executeTool('get_node', { id: 999 }, editor)).error.kind).toBe('not_found');
  });

  it('render returns the PNG as an image block and its size', async () => {
    const { editor, card } = await setup();
    const r = ok(await executeTool('render', { ids: [card], scale: 0.5 }, editor));
    expect(r.output).toEqual({ ids: [card], width: 1, height: 1 });
    expect(r.content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: expect.stringMatching(/^iVBOR/) },
    });
    expect(r.content[1]).toEqual({ type: 'text', text: '{"height":1,"ids":[2],"width":1}' });
  });

  it('list_commands searches the pinned commands, without blocked ones', async () => {
    const { editor } = await setup();
    const r = ok(await executeTool('list_commands', { query: 'node set', limit: 3 }, editor));
    const out = r.output as { total: number; commands: { id: string }[] };
    expect(out.commands.map((c) => c.id)).toContain('node.set');
    expect(out.commands.length).toBeLessThanOrEqual(3);
    const all = ok(await executeTool('list_commands', { limit: 100, query: 'save' }, editor));
    expect((all.output as { commands: { id: string }[] }).commands.map((c) => c.id)).not.toContain(
      'file.save',
    );
    const only = ok(
      await executeTool('list_commands', {}, editor, { allowedCommands: ['text.set'] }),
    );
    expect(only.output).toMatchObject({ total: 1, commands: [{ id: 'text.set' }] });
  });

  it('cuts long text results', async () => {
    const { editor } = await setup();
    const r = ok(await executeTool('list_commands', { limit: 100 }, editor, { maxTextChars: 200 }));
    const text = (r.content[0] as { text: string }).text;
    expect(text).toHaveLength(
      200 + '\n…(truncated: ask for less with fields, depth or outline)'.length,
    );
  });
});

describe('executeTool: run_batch', () => {
  it('runs one undo step and reports results, changes and touched layers', async () => {
    const { editor, card, title } = await setup();
    const r = ok(
      await executeTool(
        'run_batch',
        {
          label: 'Add a badge',
          commands: [
            {
              command: 'node.create',
              as: 'badge',
              params: { type: 'frame', parent: card, name: 'Badge', select: false },
            },
            { command: 'node.set', params: { id: { $ref: 'badge' }, props: { cornerRadius: 8 } } },
            { command: 'text.set', params: { id: title, characters: 'Hello' } },
          ],
        },
        editor,
      ),
    );
    const badge = title + 1;
    expect(r.output).toEqual({
      label: 'Add a badge',
      results: [{ id: badge }, { ok: true }, { ok: true }],
      changes: { added: [badge], removed: [], changed: [{ id: card, fields: ['children'] }] },
    });
    // The text.set changed nothing but still targeted the title.
    expect(r.touched).toEqual([card, title, badge]);
    expect((await editor.inspect({ depth: 0 })).history.undo).toEqual(['Add a badge', 'Setup']);
  });

  it('reports an editor refusal as a command error and changes nothing', async () => {
    const { editor, card } = await setup();
    const before = await editor.inspect();
    const r = err(
      await executeTool(
        'run_batch',
        {
          label: 'Broken',
          commands: [
            { command: 'node.set', params: { id: card, props: { name: 'Renamed' } } },
            { command: 'node.set', params: { id: 999, props: { name: 'x' } } },
          ],
        },
        editor,
      ),
    );
    expect(r.error).toEqual({
      kind: 'command',
      command: 'node.set',
      message: 'node.set: no such node 999. The whole batch was rolled back: nothing changed.',
    });
    expect(r.isError).toBe(true);
    expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual({ error: r.error });
    expect(await editor.inspect()).toEqual(before);
  });

  it('validates before calling the editor', async () => {
    const { editor } = await setup();
    const calls = editor.calls.length;
    const r = err(
      await executeTool(
        'run_batch',
        { label: 'x', commands: [{ command: 'node.sett', params: {} }] },
        editor,
      ),
    );
    expect(r.error.kind).toBe('validation');
    expect(r.error.message).toContain('commands.0.command: unknown command `node.sett`');
    const allowed = err(
      await executeTool(
        'run_batch',
        { label: 'x', commands: [{ command: 'node.set', params: { ids: [2], opacity: 1 } }] },
        editor,
        { allowedCommands: ['text.set'] },
      ),
    );
    expect(allowed.error).toMatchObject({
      kind: 'validation',
      message: expect.stringContaining('not allowed here'),
    });
    expect(editor.calls.length).toBe(calls);
  });

  it('still reports success when the document cannot be read back after the batch', async () => {
    class FlakyRead extends MockEditor {
      inspects = 0;
      override inspect(o?: InspectOptions): Promise<DocumentInfo> {
        if (++this.inspects === 2)
          return Promise.reject(new EditorTimeoutError('document.inspect', 5));
        return super.inspect(o);
      }
    }
    const editor = new FlakyRead();
    const r = ok(
      await executeTool(
        'run_batch',
        { label: 'One', commands: [{ command: 'node.create', params: { type: 'frame' } }] },
        editor,
      ),
    );
    expect(r.output).toEqual({ label: 'One', results: [{ id: 2 }], changes: null });
  });
});

describe('executeTool: errors and control tools', () => {
  it('maps bridge errors to typed tool errors', async () => {
    const { editor } = await setup();
    editor.setHidden(true);
    expect(err(await executeTool('get_outline', {}, editor)).error).toMatchObject({
      kind: 'hidden',
      message: expect.stringContaining('hidden'),
    });
    const home = new MockEditor({ document: false });
    expect(err(await executeTool('get_outline', {}, home)).error.kind).toBe('unavailable');
    class Slow extends MockEditor {
      override inspect(): Promise<DocumentInfo> {
        return Promise.reject(new EditorTimeoutError('document.inspect', 10));
      }
    }
    expect(err(await executeTool('get_selection', {}, new Slow())).error).toMatchObject({
      kind: 'timeout',
      message: expect.stringContaining('read the layers before retrying'),
    });
  });

  it('rethrows programming errors', async () => {
    class Broken extends MockEditor {
      override inspect(): Promise<DocumentInfo> {
        return Promise.reject(new TypeError('boom'));
      }
    }
    await expect(executeTool('get_selection', {}, new Broken())).rejects.toThrow('boom');
  });

  it('unknown tools, wrong runtimes and invalid input', async () => {
    const { editor } = await setup();
    expect(err(await executeTool('patch_nodes', {}, editor)).error.kind).toBe('unknown_tool');
    const q = {
      questions: [
        {
          id: 'a',
          prompt: 'Which?',
          kind: 'single',
          allowOther: false,
          options: [
            { id: 'x', label: 'X' },
            { id: 'y', label: 'Y' },
          ],
        },
      ],
    };
    expect(err(await executeTool('ask_followup', q, editor, { runtime: 'job' })).error).toEqual({
      kind: 'unknown_tool',
      message: 'ask_followup is not available in a background job.',
    });
    expect(err(await executeTool('get_node', { id: 'n_hero' }, editor)).error.message).toMatch(
      /^Invalid input for get_node: id: /,
    );
  });

  it('control tools are validated and handed back without touching the editor', async () => {
    const { editor } = await setup();
    const calls = editor.calls.length;
    const q = {
      questions: [
        {
          id: 'a',
          prompt: 'Which?',
          kind: 'single',
          allowOther: false,
          options: [
            { id: 'x', label: 'X' },
            { id: 'y', label: 'Y' },
          ],
        },
      ],
    };
    const ask = ok(await executeTool('ask_followup', q, editor));
    expect(ask).toMatchObject({
      output: undefined,
      content: [],
      control: { tool: 'ask_followup', input: q },
    });
    const job = { kind: 'generate', prompt: 'A pricing page', reason: 'A new page' };
    const offer = ok(await executeTool('suggest_generation_job', job, editor));
    expect(offer).toMatchObject({
      output: { status: 'offered' },
      content: [{ type: 'text', text: SUGGEST_JOB_RESULT }],
      control: { tool: 'suggest_generation_job', input: job },
    });
    expect(editor.calls.length).toBe(calls);
  });

  it('comment_thread reads a thread and replies as the agent', async () => {
    class Comments extends MockEditor {
      replies: unknown[] = [];
      override execute<C extends CommandId>(
        command: C,
        params?: CommandParams<C>,
      ): Promise<unknown> {
        if (command === 'comment.prompt')
          return Promise.resolve({ text: 'Ada on Hero: can we tighten this?' });
        if (command === 'comment.reply') {
          this.replies.push(params);
          return Promise.resolve({ ok: true });
        }
        return super.execute(command, params);
      }
    }
    const editor = new Comments();
    const read = ok(await executeTool('comment_thread', { threadId: 'c1' }, editor));
    expect(read.output).toEqual({
      thread: { text: 'Ada on Hero: can we tighten this?' },
      replied: false,
    });
    const reply = ok(
      await executeTool(
        'comment_thread',
        { threadId: 'c1', reply: 'Tightened the hero.' },
        editor,
        {
          author: 'Claude (for Ada)',
        },
      ),
    );
    expect(reply.output).toMatchObject({ replied: true });
    expect(editor.replies).toEqual([
      { id: 'c1', text: 'Tightened the hero.', author: 'Claude (for Ada)' },
    ]);
    // The mock has no comments: the real error comes back typed.
    expect(
      err(await executeTool('comment_thread', { threadId: 'c1' }, new MockEditor())).error.kind,
    ).toBe('command');
  });

  it('every output it returns fits the tool output schema', async () => {
    const { editor, card } = await setup();
    for (const [name, input] of [
      ['get_selection', {}],
      ['get_outline', {}],
      ['get_node', { id: card }],
      ['render', {}],
      ['list_commands', {}],
    ] as const) {
      const r = ok(await executeTool(name, input, editor));
      expect(AGENT_TOOLS[name].output.safeParse(r.output).success).toBe(true);
    }
  });
});

describe('executeTool: scope (Story 4.2)', () => {
  it('keeps a batch inside the scope, including new children', async () => {
    const { editor, card, title } = await setup();
    const r = ok(
      await executeTool(
        'run_batch',
        {
          label: 'Inside',
          commands: [
            { command: 'node.set', params: { id: title, props: { fontSize: 20 } } },
            { command: 'node.create', params: { type: 'rectangle', parent: card } },
          ],
        },
        editor,
        { scope: [card] },
      ),
    );
    expect(r.touched).toContain(title);
  });

  it('undoes a batch that touches a layer outside the scope', async () => {
    const { editor, card, title } = await setup();
    const other = (await editor.execute('node.create', { type: 'frame', name: 'Other' })) as {
      id: number;
    };
    const before = await editor.inspect({ fields: ['name', 'fontSize'] });
    const r = err(
      await executeTool(
        'run_batch',
        {
          label: 'Too wide',
          commands: [
            { command: 'node.set', params: { id: title, props: { fontSize: 20 } } },
            { command: 'node.set', params: { id: other.id, props: { name: 'Renamed' } } },
          ],
        },
        editor,
        { scope: [card] },
      ),
    );
    expect(r.error.kind).toBe('scope');
    expect(r.error.message).toContain(`outside the scope (${other.id})`);
    expect(r.error.message).toContain('undone: nothing changed');
    expect(r.touched).toEqual([]);
    const after = await editor.inspect({ fields: ['name', 'fontSize'] });
    expect(after.pages).toEqual(before.pages);
    expect(after.history.undo[0]).toBe('Create layer');
  });

  it('ignores layout reflow: ancestors and siblings that only moved or resized', async () => {
    /** Like the real editor: every batch moves every layer (auto layout recomputes bounds). */
    class Reflowing extends MockEditor {
      private n = 0;
      override async batch(...a: Parameters<MockEditor['batch']>) {
        this.n++;
        return super.batch(...a);
      }
      override async inspect(o?: InspectOptions, c?: Parameters<MockEditor['inspect']>[1]) {
        const doc = await super.inspect(o, c);
        const stamp = (n: { children?: unknown[] } & Record<string, unknown>) => {
          n.absoluteBounds = { y: this.n };
          n.y = this.n;
          for (const k of n.children ?? []) stamp(k as typeof n);
        };
        for (const p of doc.pages) stamp(p as never);
        return doc;
      }
    }
    const editor = new Reflowing();
    const [card, title] = (await editor.batch(
      [
        { command: 'node.create', as: 'card', params: { type: 'frame', select: false } },
        { command: 'node.create', params: { type: 'text', parent: { $ref: 'card' }, text: 'Hi' } },
        { command: 'node.create', params: { type: 'frame', name: 'Sibling', select: false } },
      ],
      { label: 'Setup' },
    )) as { id: number }[];
    const r = ok(
      await executeTool(
        'run_batch',
        {
          label: 'Inside',
          commands: [{ command: 'node.set', params: { id: title!.id, props: { fontSize: 20 } } }],
        },
        editor,
        { scope: [card!.id] },
      ),
    );
    // Every layer moved, so all are reported as changed; none counts against the scope.
    expect(r.touched.length).toBeGreaterThan(2);
  });

  it('a layer created next to the scope counts as outside it', async () => {
    const { editor, card } = await setup();
    const r = err(
      await executeTool(
        'run_batch',
        { label: 'Sibling', commands: [{ command: 'node.create', params: { type: 'frame' } }] },
        editor,
        { scope: [card] },
      ),
    );
    expect(r.error.kind).toBe('scope');
    const doc = await editor.inspect({ fields: ['name'] });
    expect(doc.pages[0]!.children!.map((c) => c.id)).toEqual([card]);
  });
});
