/**
 * Story 4.2: interactive turns with browser-run tools, against real Postgres and a stubbed model.
 * The "browser" is `ToolRunner` over a `MockEditor` with the landing fixture, talking to the
 * services directly (what the routes do).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parseSse, type Anthropic } from '@greenfield/agent';
import type { NodeId } from '@greenfield/bridge';
import { MockEditor } from '@greenfield/bridge/mock';
import { buildTurnContext } from '@greenfield/contracts';
import { buildLanding, type LandingFixture } from '@greenfield/contracts/testing';
import { agentMessages, eq, llmCalls } from '@greenfield/db';
import {
  cancelMessage,
  messageEvents,
  runTurn,
  sendMessage,
  type MessageView,
} from '@/server/services/agent';
import { settleStaleMessages, TAB_CLOSED_ERROR } from '@/server/services/agent/stale';
import {
  markSeen,
  toolCallAction,
  TOOL_LEASE_MS,
  type TurnDeps,
} from '@/server/services/agent/turn';
import { createProject } from '@/server/services/projects';
import type { Actor } from '@/server/services/types';
import { ToolRunner, type ToolRunnerApi } from '@/features/agent/tool-runner';
import { makeActor, reset, testDb } from './helpers';
import { scriptedClient, textBlock, toolUse, type ScriptedResponse } from './fakes/anthropic';

const { db, close } = testDb();
afterAll(close);
beforeEach(() => reset(db));

async function setup(script: ScriptedResponse[]) {
  const actor = await makeActor(db, 'editor');
  const project = await createProject(db, actor, { name: 'P' });
  const editor = new MockEditor();
  const fx = await buildLanding(editor);
  const client = scriptedClient(script);
  const deps: TurnDeps = {
    proxy: { loadClient: async () => ({ messages: client.messages, provider: 'anthropic' }) },
    flushMs: 0,
    cancelPollMs: 20,
    // Self-checks (Story 4.3) have their own tests (agent-self-check.test.ts).
    maxSelfChecks: 0,
  };
  return { actor, project, editor, fx, client, deps, base: editor.calls.length };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Send `prompt` with the context the panel builds for `selection`, and run the first step. */
async function send(s: Setup, prompt: string, selection: NodeId[]) {
  const ctx = await buildTurnContext(s.editor, { selection });
  const sent = await sendMessage(db, s.actor, {
    projectId: s.project.id,
    prompt,
    context: ctx.text,
    scope: ctx.scope,
  });
  return { sent, ctx, view: await runTurn(db, s.actor, sent.messageId, s.deps) };
}

/** What the routes do: claim, post the result, run the next step when the step is complete. */
function api(s: Setup, actor: Actor = s.actor): ToolRunnerApi & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    async claim(messageId, id, clientId) {
      const r = await toolCallAction(db, actor, messageId, id, { action: 'claim', clientId });
      log.push(`claim ${id} ${r.ok ? 'ok' : r.reason}`);
      return r.ok;
    },
    async result(messageId, id, body) {
      const r = await toolCallAction(db, actor, messageId, id, { action: 'result', ...body });
      log.push(`result ${id} ${r.ok ? (r.duplicate ? 'duplicate' : 'ok') : r.reason}`);
      if (r.ok && r.ready) await runTurn(db, actor, messageId, s.deps);
    },
  };
}

function runner(
  s: Setup,
  a: ToolRunnerApi,
  opts: { clientId?: string; whenVisible?: () => Promise<void> } = {},
) {
  return new ToolRunner({
    editor: () => s.editor,
    api: a,
    clientId: opts.clientId ?? 'tab_aaaaaaaa',
    whenVisible: opts.whenVisible ?? (async () => {}),
  });
}

/** Batches run since the fixture was built. */
const batches = (s: { editor: MockEditor; base: number }) =>
  s.editor.calls.slice(s.base).filter((c) => c.command === 'command.batch').length;

const lastToolResults = (req: Anthropic.MessageStreamParams) =>
  req.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];

const largerButton = (fx: LandingFixture, id = 'tu_1') =>
  toolUse(id, 'run_batch', {
    label: 'Make the button larger',
    commands: [
      {
        command: 'node.set',
        params: { id: fx.ids.n_herocta001, props: { padding: [12, 24, 12, 24] } },
      },
    ],
  });

async function view(s: Setup, messageId: string) {
  const [row] = await db.select().from(agentMessages).where(eq(agentMessages.id, messageId));
  return row!;
}

describe('interactive turn (Story 4.2)', () => {
  it('streams a tool call to the tab, takes its result back and runs the next step', async () => {
    const s = await setup([]);
    // The script needs fixture ids, so build it after the fixture.
    const script: ScriptedResponse[] = [
      { content: [textBlock('Making it larger.'), largerButton(s.fx)], stopReason: 'tool_use' },
      { content: [textBlock('Done: more padding on the button.')] },
    ];
    s.client.messages = scriptedClient(script).messages;
    const calls: Anthropic.MessageStreamParams[] = [];
    const inner = s.client.messages;
    s.client.messages = {
      ...inner,
      stream: (body, o) => {
        calls.push(structuredClone(body));
        return inner.stream(body, o);
      },
    };
    const button = s.fx.ids.n_herocta001!;
    const { sent, ctx, view: v1 } = await send(s, 'Make this button larger.', [button]);

    // Step 1: the call waits for the tab; the scope is the selection.
    expect(v1).toMatchObject({
      status: 'streaming',
      scope: [button],
      toolCalls: [{ id: 'tu_1', name: 'run_batch', state: 'queued' }],
      activity: [{ id: 'tu_1', status: 'running' }],
    });
    expect(v1.text).toBe('Making it larger.');
    // The model got the prefix, then the context and the request in the user turn.
    const first = calls[0]!;
    expect(first.model).toBe('claude-sonnet-5-5');
    expect((first.system as Anthropic.TextBlockParam[])[0]!.text).toContain('<craft>');
    expect(JSON.stringify(first.messages.at(-1))).toContain(JSON.stringify(ctx.text).slice(1, 40));
    expect(JSON.stringify(first.messages.at(-1))).toContain('Make this button larger.');

    // The SSE stream shows the call to the tab.
    let frames = '';
    for await (const f of messageEvents(db, s.actor, sent.messageId, { pollMs: 5 })) {
      frames += f;
      if (frames.includes('event: message')) break;
    }
    const msg = parseSse(frames).find((e) => e.event === 'message')!;
    expect((JSON.parse(msg.data) as MessageView).toolCalls[0]!.id).toBe('tu_1');

    // The tab runs it through the bridge and posts the result; the next step runs.
    const a = api(s);
    await runner(s, a).handle(v1);
    expect(a.log).toEqual(['claim tu_1 ok', 'result tu_1 ok']);
    expect(await s.editor.getNode(button)).toMatchObject({
      padding: [12, 24, 12, 24],
    });
    // One run_batch = one undo step.
    expect((await s.editor.inspect({ depth: 0 })).history.undo[0]).toBe('Make the button larger');

    expect(calls).toHaveLength(2);
    expect(lastToolResults(calls[1]!)).toEqual([
      expect.objectContaining({ type: 'tool_result', tool_use_id: 'tu_1' }),
    ]);
    expect(lastToolResults(calls[1]!)[0]!.is_error).toBeUndefined();
    // The cached prefix is identical on both steps.
    expect(JSON.stringify(calls[1]!.system)).toBe(JSON.stringify(calls[0]!.system));
    expect(JSON.stringify(calls[1]!.tools)).toBe(JSON.stringify(calls[0]!.tools));

    const done = await view(s, sent.messageId);
    expect(done.status).toBe('complete');
    const content = done.content as { turns: unknown[]; touched: string[]; run?: unknown };
    expect(content.turns).toHaveLength(3);
    expect(content.touched).toEqual([String(button)]);
    expect(content.run).toBeUndefined();
    // Both model calls were metered.
    expect(await db.select().from(llmCalls)).toHaveLength(2);
  });

  it('runs a tool call once: one claim wins, repeats are ignored or duplicates', async () => {
    const s = await setup([]);
    s.client.messages = scriptedClient([
      { content: [largerButton(s.fx)], stopReason: 'tool_use' },
      { content: [textBlock('Done.')] },
    ]).messages;
    const { sent, view: v1 } = await send(s, 'Larger', [s.fx.ids.n_herocta001!]);

    // The same view twice (SSE reconnect) in this tab, and the same call in a second tab.
    const a = api(s);
    const tab = runner(s, a);
    const other = runner(s, a, { clientId: 'tab_bbbbbbbb' });
    await Promise.all([tab.handle(v1), tab.handle(v1), other.handle(v1)]);
    expect(batches(s)).toBe(1);
    expect(a.log.filter((l) => l.startsWith('claim'))).toHaveLength(2);
    expect(a.log.filter((l) => l === 'claim tu_1 ok')).toHaveLength(1);
    expect(a.log.filter((l) => l.startsWith('result'))).toEqual(['result tu_1 ok']);

    // After the turn, nothing about the call can run again.
    const body = {
      action: 'result' as const,
      content: [{ type: 'text' as const, text: '{}' }],
      isError: false,
    };
    for (const clientId of ['tab_aaaaaaaa', 'tab_bbbbbbbb'])
      expect(
        await toolCallAction(db, s.actor, sent.messageId, 'tu_1', { ...body, clientId }),
      ).toEqual({ ok: false, reason: 'not_running' });
    expect(
      await toolCallAction(db, s.actor, sent.messageId, 'tu_1', {
        action: 'claim',
        clientId: 'tab_cccccccc',
      }),
    ).toEqual({ ok: false, reason: 'not_running' });
    expect((await view(s, sent.messageId)).status).toBe('complete');
  });

  it('the idempotency key: one claim per call, a repeated result is a duplicate', async () => {
    const s = await setup([]);
    s.client.messages = scriptedClient([
      { content: [largerButton(s.fx)], stopReason: 'tool_use' },
      { content: [textBlock('Done.')] },
    ]).messages;
    const { sent } = await send(s, 'Larger', [s.fx.ids.n_herocta001!]);
    const act = (body: Parameters<typeof toolCallAction>[4]) =>
      toolCallAction(db, s.actor, sent.messageId, 'tu_1', body);
    const result = {
      action: 'result' as const,
      content: [{ type: 'text' as const, text: '{}' }],
      isError: false,
    };
    expect(await act({ action: 'claim', clientId: 'tab_aaaaaaaa' })).toEqual({ ok: true });
    // The same tab may re-claim (a retry after a hidden tab); no other tab can.
    expect(await act({ action: 'claim', clientId: 'tab_aaaaaaaa' })).toEqual({ ok: true });
    expect(await act({ action: 'claim', clientId: 'tab_bbbbbbbb' })).toEqual({
      ok: false,
      reason: 'claimed',
    });
    expect(await act({ ...result, clientId: 'tab_bbbbbbbb' })).toEqual({
      ok: false,
      reason: 'claimed',
    });
    expect(await act({ ...result, clientId: 'tab_aaaaaaaa' })).toEqual({ ok: true, ready: true });
    expect(await act({ ...result, clientId: 'tab_aaaaaaaa' })).toEqual({
      ok: true,
      duplicate: true,
    });
    expect(await act({ action: 'claim', clientId: 'tab_aaaaaaaa' })).toEqual({
      ok: false,
      reason: 'not_running',
    });
    await runTurn(db, s.actor, sent.messageId, s.deps);
    const row = await view(s, sent.messageId);
    expect(row.status).toBe('complete');
    // The result went to the model once.
    const turns = (row.content as { turns: Anthropic.MessageParam[] }).turns;
    expect(JSON.stringify(turns).match(/"tool_use_id":"tu_1"/g)).toHaveLength(1);
  });

  it('only the sender runs the tools; other members get not found', async () => {
    const s = await setup([]);
    s.client.messages = scriptedClient([
      { content: [largerButton(s.fx)], stopReason: 'tool_use' },
    ]).messages;
    const { sent } = await send(s, 'Larger', [s.fx.ids.n_herocta001!]);
    const colleague = await makeActor(db, 'editor', s.actor.workspace);
    await expect(
      toolCallAction(db, colleague, sent.messageId, 'tu_1', {
        action: 'claim',
        clientId: 'tab_dddddddd',
      }),
    ).rejects.toThrow('Message not found');
  });

  it('a closed tab cancels the turn cleanly; an open stream keeps it alive', async () => {
    const s = await setup([]);
    s.client.messages = scriptedClient([
      { content: [largerButton(s.fx)], stopReason: 'tool_use' },
      { content: [textBlock('should never run')] },
    ]).messages;
    const { sent } = await send(s, 'Larger', [s.fx.ids.n_herocta001!]);
    const t0 = Date.now();
    const at = (ms: number) => new Date(t0 + ms);

    // The tab's stream refreshes the lease: still running past the first lease.
    await markSeen(db, s.actor, await view(s, sent.messageId), at(TOOL_LEASE_MS - 5_000));
    expect(await settleStaleMessages(db, { now: at(TOOL_LEASE_MS + 1_000) })).toBe(0);
    expect((await view(s, sent.messageId)).status).toBe('streaming');

    // Then the tab goes away: no stream, claim or result for a lease.
    expect(await settleStaleMessages(db, { now: at(2 * TOOL_LEASE_MS) })).toBe(1);
    const row = await view(s, sent.messageId);
    expect(row).toMatchObject({ status: 'cancelled', error: TAB_CLOSED_ERROR });

    // Nothing runs after that: the call can't be claimed and no model step starts.
    const a = api(s);
    await runner(s, a).handle({ ...(await runTurn(db, s.actor, sent.messageId, s.deps)) });
    expect(a.log).toEqual([]);
    expect(
      await toolCallAction(db, s.actor, sent.messageId, 'tu_1', {
        action: 'claim',
        clientId: 'tab_aaaaaaaa',
      }),
    ).toEqual({ ok: false, reason: 'not_running' });
    expect(batches(s)).toBe(0);
    expect(await db.select().from(llmCalls)).toHaveLength(1);
  });

  it('the pagehide beacon cancels at once; a late result is refused', async () => {
    const s = await setup([]);
    s.client.messages = scriptedClient([
      { content: [largerButton(s.fx)], stopReason: 'tool_use' },
    ]).messages;
    const { sent } = await send(s, 'Larger', [s.fx.ids.n_herocta001!]);
    expect(
      await toolCallAction(db, s.actor, sent.messageId, 'tu_1', {
        action: 'claim',
        clientId: 'tab_aaaaaaaa',
      }),
    ).toEqual({ ok: true });
    expect((await cancelMessage(db, s.actor, sent.messageId)).status).toBe('cancelled');
    expect(
      await toolCallAction(db, s.actor, sent.messageId, 'tu_1', {
        action: 'result',
        clientId: 'tab_aaaaaaaa',
        content: [{ type: 'text', text: '{}' }],
        isError: false,
      }),
    ).toEqual({ ok: false, reason: 'not_running' });
  });

  it('a hidden tab pauses the turn and resumes it when shown', async () => {
    const s = await setup([]);
    s.client.messages = scriptedClient([
      { content: [largerButton(s.fx)], stopReason: 'tool_use' },
      { content: [textBlock('Done.')] },
    ]).messages;
    const { sent, view: v1 } = await send(s, 'Larger', [s.fx.ids.n_herocta001!]);
    s.editor.setHidden(true);
    let show!: () => void;
    const shown = new Promise<void>((r) => (show = r));
    let waiting = 0;
    const tab = runner(s, api(s), {
      whenVisible: () => {
        waiting++;
        return shown;
      },
    });
    const running = tab.handle(v1);
    await new Promise((r) => setTimeout(r, 50));
    // Paused: the bridge failed fast, nothing ran, the claim is held, the turn is waiting.
    expect(waiting).toBe(1);
    expect(batches(s)).toBe(0);
    const paused = await view(s, sent.messageId);
    expect(paused.status).toBe('streaming');
    expect(JSON.stringify(paused.content)).toContain('"state":"claimed"');

    s.editor.setHidden(false);
    show();
    await running;
    expect(batches(s)).toBe(1);
    expect((await view(s, sent.messageId)).status).toBe('complete');
  });

  it('undoes an edit outside the scope and returns it to the model as an error', async () => {
    const s = await setup([]);
    const calls: Anthropic.MessageStreamParams[] = [];
    const inner = scriptedClient([
      {
        content: [
          toolUse('tu_1', 'run_batch', {
            label: 'Button and nav',
            commands: [
              {
                command: 'node.set',
                params: { id: s.fx.ids.n_herocta001, props: { padding: 16 } },
              },
              {
                command: 'node.set',
                params: { id: s.fx.ids.n_navcta0001, props: { padding: 16 } },
              },
            ],
          }),
        ],
        stopReason: 'tool_use',
      },
      { content: [largerButton(s.fx, 'tu_2')], stopReason: 'tool_use' },
      { content: [textBlock('Only the button changed.')] },
    ]).messages;
    s.client.messages = {
      ...inner,
      stream: (body, o) => {
        calls.push(structuredClone(body));
        return inner.stream(body, o);
      },
    };
    const before = await s.editor.inspect();
    const { sent, view: v1 } = await send(s, 'Make this button larger.', [s.fx.ids.n_herocta001!]);
    const a = api(s);
    const tab = runner(s, a);
    await tab.handle(v1);
    // The undone batch left the document as it was.
    expect((await s.editor.inspect()).pages).toEqual(before.pages);
    const refused = lastToolResults(calls[1]!)[0]!;
    expect(refused).toMatchObject({ tool_use_id: 'tu_1', is_error: true });
    expect(JSON.stringify(refused.content)).toContain('outside the scope');
    // The model's second try stays in scope.
    const v2 = await runTurn(db, s.actor, sent.messageId, s.deps);
    await tab.handle(v2);
    const row = await view(s, sent.messageId);
    expect(row.status).toBe('complete');
    expect((row.content as { touched: string[] }).touched).toEqual([String(s.fx.ids.n_herocta001)]);
    expect((await s.editor.inspect({ depth: 0 })).history.undo.slice(0, 2)).toEqual([
      'Make the button larger',
      'Landing fixture',
    ]);
  });

  it('answers invalid calls on the server without a round trip', async () => {
    const s = await setup([
      {
        content: [
          toolUse('tu_1', 'run_batch', { label: 'x', commands: [] }),
          toolUse('tu_2', 'patch_nodes', {}),
        ],
        stopReason: 'tool_use',
      },
      { content: [textBlock('Sorry.')] },
    ]);
    const { sent, view: v1 } = await send(s, 'x', []);
    expect(v1.toolCalls).toEqual([]);
    const row = await view(s, sent.messageId);
    expect(row.status).toBe('complete');
    expect(JSON.stringify(row.content)).toContain('Unknown tool: patch_nodes');
  });
});
