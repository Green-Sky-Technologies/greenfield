/**
 * Story 10.5: Claude follows the file's design system. The guide and summary go in the cached
 * prefix; after a turn the server reads the changed layers through the tab and checks them; raw
 * colours and off-scale spacing go back to the model, which fixes them; the reply records what
 * was fixed. Real Postgres, stubbed model; the "browser" is `ToolRunner` over a `MockEditor`
 * whose check reads return layers the way the real editor's `node.get` does.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Anthropic } from '@greenfield/agent';
import { MockEditor } from '@greenfield/bridge/mock';
import { buildTurnContext } from '@greenfield/contracts';
import { buildLanding } from '@greenfield/contracts/testing';
import { getMessageView, runTurn, sendMessage, type MessageView } from '@/server/services/agent';
import { toolCallAction, type TurnDeps } from '@/server/services/agent/turn';
import { localFsStorage } from '@/server/services/design-files';
import {
  createDesignSystem,
  createProjectWithDefaultSystem,
  publishDesignSystem,
  setDefaultDesignSystem,
} from '@/server/services/design-systems';
import { checkLayers, rulesFor, systemPrompt } from '@/server/services/design-systems/check';
import { createProject } from '@/server/services/projects';
import { ToolRunner } from '@/features/agent/tool-runner';
import { makeActor, reset, testDb } from './helpers';
import { scriptedClient, textBlock, toolUse, type ScriptedResponse } from './fakes/anthropic';

const LIBRARY = new Uint8Array(
  fs.readFileSync(path.join(import.meta.dirname, 'fixtures/voirdire-library.figcraft')),
);
const { db, close } = testDb();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-follow-'));
const storage = localFsStorage(dir);
afterAll(async () => {
  await close();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => reset(db));

const SUMMARY = [
  {
    key: 'colours:1',
    kind: 'colours' as const,
    name: 'Ink and paper',
    colours: [
      { name: 'ink/900', hex: '#14140f' },
      { name: 'paper/50', hex: '#f6f3ec' },
    ],
  },
  {
    key: 'colours:2',
    kind: 'colours' as const,
    name: 'Accents',
    colours: [{ name: 'rubric/500', hex: '#df4630' }],
  },
  {
    key: 'spacing:3',
    kind: 'spacing' as const,
    name: 'Spacing',
    values: [
      { name: 'space/2', value: 8 },
      { name: 'space/4', value: 16 },
    ],
  },
  {
    key: 'spacing:4',
    kind: 'spacing' as const,
    name: 'Radius',
    values: [{ name: 'r/2', value: 6 }],
  },
];

/** A frame as the real editor's node.get returns it (fields from the pinned figcraft-web). */
const frame = (over: Record<string, unknown> = {}, children: unknown[] = []) => ({
  id: 10,
  name: 'FAQ',
  type: 'FRAME',
  fills: [{ type: 'solid', color: '#E1472F' }],
  strokes: [],
  layout: { mode: 'vertical', gap: 18, padding: [16, 16, 16, 16], mainAlign: 'min' },
  boundVariables: {},
  styles: { fill: null, stroke: null, effect: null, grid: null, text: null },
  children,
  ...over,
});

describe('the check (10.5)', () => {
  const rules = rulesFor('Voirdire', SUMMARY);

  it('flags raw colours and off-scale spacing, with the nearest variable', () => {
    const found = checkLayers(
      [
        frame({}, [
          { id: 11, name: 'Q1', type: 'FRAME', fills: [{ type: 'solid', color: '#E1472F' }] },
          { id: 12, name: 'Title', type: 'TEXT', fills: [{ type: 'solid', color: '#14140F' }] },
        ]),
      ],
      rules,
    );
    expect(found).toEqual([
      {
        kind: 'colour',
        field: 'fill',
        value: '#e1472f',
        layers: [
          { id: 10, name: 'FAQ' },
          { id: 11, name: 'Q1' },
        ],
        suggestion: { name: 'rubric/500', value: '#df4630' },
      },
      {
        kind: 'spacing',
        field: 'gap',
        value: 18,
        layers: [{ id: 10, name: 'FAQ' }],
        suggestion: { name: 'space/4', value: 16 },
      },
      {
        kind: 'colour',
        field: 'fill',
        value: '#14140f',
        layers: [{ id: 12, name: 'Title' }],
        suggestion: { name: 'ink/900', value: '#14140f' },
      },
    ]);
  });

  it('passes bound values, styled paints, values on the scale and instances', () => {
    const found = checkLayers(
      [
        frame(
          {
            boundVariables: { fill: 'VariableID:6', gap: 'VariableID:10' },
            layout: { mode: 'vertical', gap: 18, padding: [8, 16, 8, 16] },
          },
          [
            {
              id: 11,
              name: 'Styled',
              type: 'TEXT',
              fills: [{ type: 'solid', color: '#123456' }],
              styles: { fill: 'S:1' },
            },
            {
              id: 12,
              name: 'Button',
              type: 'INSTANCE',
              fills: [{ type: 'solid', color: '#123456' }],
            },
            {
              id: 13,
              name: 'Hidden',
              type: 'RECTANGLE',
              fills: [{ type: 'solid', color: '#123456', visible: false }],
            },
          ],
        ),
      ],
      rules,
    );
    expect(found).toEqual([]);
  });

  it('checks only the layers it is given', () => {
    const found = checkLayers([frame()], rules, new Set([99]));
    expect(found).toEqual([]);
  });

  it('keeps radii out of the spacing scale', () => {
    expect(rules.spacing.map((s) => s.value)).toEqual([8, 16]);
  });

  it('writes a stable prefix block with the guide and the summary', () => {
    const text = systemPrompt({
      name: 'Voirdire',
      version: 3,
      guide: 'Ink on paper.',
      summary: SUMMARY,
    });
    expect(text).toBe(
      systemPrompt({ name: 'Voirdire', version: 3, guide: 'Ink on paper.', summary: SUMMARY }),
    );
    expect(text).toContain('<design_system name="Voirdire" version="3">');
    expect(text).toContain('- Colours · Accents: rubric/500 #df4630');
    expect(text).toContain('- Scale · Spacing: space/2 8, space/4 16');
    expect(text).toContain('Ink on paper.');
  });
});

async function setup(withSystem: boolean) {
  const admin = await makeActor(db, 'admin');
  let project;
  if (withSystem) {
    const { system } = await createDesignSystem(db, admin, storage, {
      name: 'Voirdire',
      bytes: LIBRARY,
      guide: 'Rubric only for emphasis.',
    });
    await publishDesignSystem(db, admin, storage, { systemId: system.id });
    await setDefaultDesignSystem(db, admin, { systemId: system.id });
    project = await createProjectWithDefaultSystem(db, admin, storage, { name: 'P' });
  } else project = await createProject(db, admin, { name: 'P' });

  const editor = new MockEditor();
  const fx = await buildLanding(editor);
  // The check reads (fields include boundVariables) see the new layer as the real editor shows
  // it: raw on the first read, bound after the agent's fix.
  const reads: number[] = [];
  const getNode = editor.getNode.bind(editor);
  editor.getNode = async (id, opts = {}, call) => {
    const node = await getNode(id, opts, call);
    // The context builder reads too; the check's reads are the deep ones with these fields.
    const fields = (opts.fields as string[] | undefined) ?? [];
    if (!node || opts.depth !== 8 || !fields.includes('styles')) return node;
    reads.push(id);
    const fixed = reads.length > 1;
    const decorate = (n: Record<string, unknown>): Record<string, unknown> => ({
      ...n,
      ...(n.name === 'FAQ'
        ? frame(
            fixed
              ? {
                  boundVariables: { fill: 'VariableID:6', gap: 'VariableID:10' },
                  layout: { mode: 'vertical', gap: 16, padding: [16, 16, 16, 16] },
                }
              : {},
          )
        : {}),
      id: n.id,
      name: n.name,
      children: Array.isArray(n.children)
        ? n.children.map((c) => decorate(c as Record<string, unknown>))
        : [],
    });
    return decorate(node as never) as never;
  };

  const client = scriptedClient([]);
  const deps: TurnDeps = {
    proxy: { loadClient: async () => ({ messages: client.messages, provider: 'anthropic' }) },
    flushMs: 0,
    cancelPollMs: 20,
    maxSelfChecks: 0,
  };
  return { actor: admin, project, editor, fx, client, deps, reads };
}
type Setup = Awaited<ReturnType<typeof setup>>;

function script(s: Setup, responses: ScriptedResponse[]) {
  const inner = scriptedClient(responses).messages;
  const calls: Anthropic.MessageStreamParams[] = [];
  s.client.messages = {
    ...inner,
    stream: (body, o) => {
      calls.push(structuredClone(body));
      return inner.stream(body, o);
    },
  };
  return calls;
}

async function run(s: Setup, prompt: string, selection: number[]) {
  const ctx = await buildTurnContext(s.editor, { selection });
  const sent = await sendMessage(db, s.actor, {
    projectId: s.project.id,
    prompt,
    context: ctx.text,
  });
  const views: MessageView[] = [await runTurn(db, s.actor, sent.messageId, s.deps)];
  const tab = new ToolRunner({
    editor: () => s.editor,
    clientId: 'tab_aaaaaaaa',
    whenVisible: async () => {},
    api: {
      claim: async (m, id, clientId) =>
        (await toolCallAction(db, s.actor, m, id, { action: 'claim', clientId })).ok,
      async result(m, id, body) {
        const r = await toolCallAction(db, s.actor, m, id, { action: 'result', ...body });
        if (r.ok && r.ready) await runTurn(db, s.actor, m, s.deps);
      },
    },
  });
  for (let i = 0; i < 20; i++) {
    const v = views.at(-1)!;
    if (!['pending', 'streaming'].includes(v.status)) break;
    await tab.handle(v);
    views.push(await getMessageView(db, s.actor, sent.messageId));
  }
  return views.at(-1)!;
}

const addFaq = (parent: number, tu = 'tu_1') =>
  toolUse(tu, 'run_batch', {
    label: 'Add FAQ',
    commands: [
      {
        command: 'node.create',
        params: { type: 'frame', name: 'FAQ', parent, props: { fill: '#E1472F' } },
      },
    ],
  });
const bindFaq = (root: number, tu = 'tu_2') =>
  toolUse(tu, 'run_batch', {
    label: 'Use the system',
    commands: [{ command: 'node.set', params: { id: root, props: { opacity: 0.9 } } }],
  });

describe('Claude follows the system (10.5)', () => {
  it('puts the guide in the cached prefix, checks the turn and has the agent fix it', async () => {
    const s = await setup(true);
    const root = s.fx.ids.n_root000001!;
    const calls = script(s, [
      { content: [addFaq(root)], stopReason: 'tool_use' },
      { content: [textBlock('Added an FAQ.')] },
      { content: [bindFaq(root)], stopReason: 'tool_use' },
      { content: [textBlock('Bound the FAQ to rubric/500 and space/4.')] },
    ]);
    const final = await run(s, 'Add an FAQ', [root]);

    // The system's block is the second, separately cached, system block of every call.
    const system = calls[0]!.system as Anthropic.TextBlockParam[];
    expect(system).toHaveLength(2);
    expect(system[1]!.text).toContain('<design_system name="Voirdire" version="1">');
    expect(system[1]!.text).toContain('Rubric only for emphasis.');
    expect(system[1]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(calls.map((c) => JSON.stringify(c.system))).toEqual(
      calls.map(() => JSON.stringify(calls[0]!.system)),
    );

    // After "Added an FAQ." the server read the frame and sent the findings back.
    expect(calls).toHaveLength(4);
    const findings = JSON.stringify(calls[2]!.messages.at(-1));
    expect(findings).toContain('Design system check (Voirdire)');
    expect(findings).toContain('Raw colour #e1472f as fill on \\"FAQ\\"');
    expect(findings).toContain('bind fill to rubric/500 (#df4630)');
    expect(findings).toContain('Gap 18 is off the spacing scale');

    // The second check came back clean; the reply says what was fixed.
    expect(s.reads).toEqual([root, root]);
    expect(final.status).toBe('complete');
    expect(final.designCheck).toEqual({
      system: 'Voirdire',
      fixed: [
        'Replaced #e1472f with rubric/500 on 1 layer.',
        'Moved gap 18 to space/4 (16) on 1 layer.',
      ],
      left: [],
    });
  });

  it('a file without a system gets no block and no check', async () => {
    const s = await setup(false);
    const root = s.fx.ids.n_root000001!;
    const calls = script(s, [
      { content: [addFaq(root)], stopReason: 'tool_use' },
      { content: [textBlock('Added an FAQ.')] },
    ]);
    const final = await run(s, 'Add an FAQ', [root]);
    expect((calls[0]!.system as unknown[]).length).toBe(1);
    expect(calls).toHaveLength(2);
    expect(s.reads).toEqual([]);
    expect(final.designCheck).toBeNull();
  });

  it('stops after two rounds and reports what is left', async () => {
    const s = await setup(true);
    const root = s.fx.ids.n_root000001!;
    // Every read shows the raw values: the fix "didn't take".
    s.reads.push = function (...ids: number[]) {
      Array.prototype.push.apply(this, ids);
      this.length = Math.min(this.length, 1);
      return this.length;
    };
    const calls = script(s, [
      { content: [addFaq(root)], stopReason: 'tool_use' },
      { content: [textBlock('Added an FAQ.')] },
      { content: [bindFaq(root)], stopReason: 'tool_use' },
      { content: [textBlock('Fixed.')] },
    ]);
    const final = await run(s, 'Add an FAQ', [root]);
    expect(calls).toHaveLength(4);
    expect(final.status).toBe('complete');
    expect(final.designCheck?.fixed).toEqual([]);
    expect(final.designCheck?.left.map((v) => v.value)).toEqual(['#e1472f', 18]);
  });
});
