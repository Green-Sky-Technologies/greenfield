/**
 * Story 4.3 (self-check) and Story 4.7 (change records, "Show on canvas", "Undo all") on the
 * interactive path. Real Postgres, stubbed model; the "browser" is `ToolRunner` over a
 * `MockEditor` with the landing fixture.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError } from '@greenfield/authz';
import type { Anthropic } from '@greenfield/agent';
import { MockEditor } from '@greenfield/bridge/mock';
import { buildTurnContext, planRevert } from '@greenfield/contracts';
import { buildLanding } from '@greenfield/contracts/testing';
import { agentMessages, eq } from '@greenfield/db';
import {
  getMessageView,
  revertTurn,
  runTurn,
  sendMessage,
  type MessageView,
} from '@/server/services/agent';
import {
  SELF_CHECK_PROMPT,
  SELF_CHECK_SCALE,
  toolCallAction,
  type TurnDeps,
} from '@/server/services/agent/turn';
import { createProject } from '@/server/services/projects';
import { ValidationError } from '@/server/services/types';
import { ToolRunner } from '@/features/agent/tool-runner';
import { makeActor, reset, testDb } from './helpers';
import { scriptedClient, textBlock, toolUse, type ScriptedResponse } from './fakes/anthropic';

const { db, close } = testDb();
afterAll(close);
beforeEach(() => reset(db));

async function setup() {
  const actor = await makeActor(db, 'editor');
  const project = await createProject(db, actor, { name: 'P' });
  const editor = new MockEditor();
  const fx = await buildLanding(editor);
  const client = scriptedClient([]);
  const deps: TurnDeps = {
    proxy: { loadClient: async () => ({ messages: client.messages, provider: 'anthropic' }) },
    flushMs: 0,
    cancelPollMs: 20,
  };
  return { actor, project, editor, fx, client, deps };
}
type Setup = Awaited<ReturnType<typeof setup>>;

function script(s: Setup, responses: ScriptedResponse[]) {
  s.client.messages = scriptedClient(responses).messages;
  const calls: Anthropic.MessageStreamParams[] = [];
  const inner = s.client.messages;
  s.client.messages = {
    ...inner,
    stream: (body, o) => {
      calls.push(structuredClone(body));
      return inner.stream(body, o);
    },
  };
  return calls;
}

/** Send with the selection as scope, then play the tab until the reply ends. */
async function run(s: Setup, prompt: string, selection: number[]) {
  const ctx = await buildTurnContext(s.editor, { selection });
  const sent = await sendMessage(db, s.actor, {
    projectId: s.project.id,
    prompt,
    context: ctx.text,
    scope: ctx.scope,
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
  return { messageId: sent.messageId, views, final: views.at(-1)! };
}

const pad = (id: number, padding: number, tu = 'tu_1') =>
  toolUse(tu, 'run_batch', {
    label: `Padding ${padding}`,
    commands: [{ command: 'node.set', params: { id, props: { padding } } }],
  });

const hasImage = (v: unknown) => JSON.stringify(v).includes('"type":"image"');

describe('self-check (Story 4.3)', () => {
  it('renders the changed frame after the edit, shows it to the model, keeps no render', async () => {
    const s = await setup();
    const button = s.fx.ids.n_herocta001!;
    const calls = script(s, [
      { content: [pad(button, 20)], stopReason: 'tool_use' },
      { content: [textBlock('Done: more padding.')] },
      { content: [textBlock('Checked: it looks right.')] },
    ]);
    const { messageId, views, final } = await run(s, 'Larger button', [button]);

    // After the model's final answer the tab got a render of the edited frame to run.
    const checking = views.find((v) => v.checking)!;
    expect(checking.toolCalls).toEqual([
      {
        id: 'selfcheck_1',
        name: 'render',
        input: { ids: [s.fx.ids.n_root000001], scale: SELF_CHECK_SCALE },
        state: 'queued',
      },
    ]);
    // The model saw the render with the self-check prompt, then ended the turn.
    expect(calls).toHaveLength(3);
    const shown = calls[2]!.messages.at(-1)!;
    expect(shown.role).toBe('user');
    expect(JSON.stringify(shown)).toContain(SELF_CHECK_PROMPT.slice(0, 40));
    expect(hasImage(shown)).toBe(true);
    expect(final.status).toBe('complete');
    expect(final.text).toContain('Checked: it looks right.');

    // Renders are not stored beyond the turn.
    const [row] = await db.select().from(agentMessages).where(eq(agentMessages.id, messageId));
    expect(hasImage(row!.content)).toBe(false);
    expect(JSON.stringify(row!.content)).toContain('it is not kept');
  });

  it('caps self-checks per turn', async () => {
    const s = await setup();
    const button = s.fx.ids.n_herocta001!;
    const calls = script(s, [
      { content: [pad(button, 20, 'tu_1')], stopReason: 'tool_use' },
      { content: [textBlock('Done.')] },
      { content: [pad(button, 22, 'tu_2')], stopReason: 'tool_use' },
      { content: [textBlock('Fixed.')] },
      { content: [pad(button, 24, 'tu_3')], stopReason: 'tool_use' },
      { content: [textBlock('Fixed again.')] },
    ]);
    const { views, final } = await run(s, 'Larger button', [button]);
    const checks = new Set(views.filter((v) => v.checking).map((v) => v.toolCalls[0]!.id));
    expect([...checks]).toEqual(['selfcheck_1', 'selfcheck_2']);
    expect(calls).toHaveLength(6);
    expect(final.status).toBe('complete');
  });

  it("doesn't check again when the model rendered after its last edit", async () => {
    const s = await setup();
    const button = s.fx.ids.n_herocta001!;
    const calls = script(s, [
      { content: [pad(button, 20)], stopReason: 'tool_use' },
      {
        content: [toolUse('tu_r', 'render', { ids: [s.fx.ids.n_root000001] })],
        stopReason: 'tool_use',
      },
      { content: [textBlock('Done and checked.')] },
    ]);
    const { views, final } = await run(s, 'Larger button', [button]);
    expect(views.some((v) => v.checking)).toBe(false);
    expect(calls).toHaveLength(3);
    expect(final.status).toBe('complete');
  });

  it('a read-only turn is not checked', async () => {
    const s = await setup();
    const calls = script(s, [{ content: [textBlock('It is a hero section.')] }]);
    const { final } = await run(s, 'What is this?', [s.fx.ids.n_hero000001!]);
    expect(final.status).toBe('complete');
    expect(calls).toHaveLength(1);
  });
});

describe('change records (Story 4.7)', () => {
  it('lists what the turn changed, what to show, and undoes it all', async () => {
    const s = await setup();
    const button = s.fx.ids.n_herocta001!;
    const title = s.fx.ids.n_herotitle1!;
    const before = await s.editor.getNode(title, { fields: ['characters'] as never });
    script(s, [
      {
        content: [
          toolUse('tu_1', 'run_batch', {
            label: 'Tighten hero',
            commands: [
              { command: 'node.set', params: { id: button, props: { padding: 20 } } },
              { command: 'node.set', params: { id: title, props: { characters: 'Ship it.' } } },
            ],
          }),
        ],
        stopReason: 'tool_use',
      },
      { content: [pad(button, 16, 'tu_2')], stopReason: 'tool_use' },
      { content: [textBlock('Tightened the hero.')] },
    ]);
    s.deps.maxSelfChecks = 0;
    const { messageId, final } = await run(s, 'Tighten the hero', [s.fx.ids.n_hero000001!]);
    expect(final.status).toBe('complete');

    // One record per layer, folded across the turn's two batches.
    const byId = new Map(final.changes.map((c) => [c.id, c]));
    expect(byId.get(button)!.fields.find((f) => f.field === 'padding')).toMatchObject({
      after: 16,
    });
    expect(byId.get(title)!.fields).toContainEqual({
      field: 'characters',
      before: before!.characters,
      after: 'Ship it.',
    });
    expect(final.showOnCanvas.sort()).toEqual([button, title].sort());
    expect(final.undoLabels).toEqual(['Tighten hero', 'Padding 16']);

    // "Undo all" in the tab: the turn is the newest history, so it undoes both steps.
    const history = (await s.editor.inspect({ depth: 0 })).history.undo;
    const plan = planRevert(final.changes, final.undoLabels, history);
    expect(plan).toEqual({ kind: 'undo', steps: 2 });
    for (let i = 0; i < 2; i++) await s.editor.execute('edit.undo', {});
    expect(await s.editor.getNode(title)).toMatchObject({ characters: before!.characters });

    const viewer = await makeActor(db, 'viewer', s.actor.workspace);
    await expect(revertTurn(db, viewer, messageId, { how: 'undo' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const reverted = await revertTurn(db, s.actor, messageId, { how: 'undo' });
    expect(reverted.reverted).toMatchObject({ how: 'undo', by: s.actor.userId });
    await expect(revertTurn(db, s.actor, messageId, { how: 'undo' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
