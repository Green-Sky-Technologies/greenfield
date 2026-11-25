/**
 * Story 4.4: follow-up questions. ask_followup ends the turn; the answers (or a skip, or a new
 * message) become its tool_result and the agent carries on. Real Postgres, stubbed model.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError } from '@greenfield/authz';
import type { Anthropic } from '@greenfield/agent';
import { answerQuestions, getProjectChat, runTurn, sendMessage } from '@/server/services/agent';
import type { TurnDeps } from '@/server/services/agent/turn';
import { createProject } from '@/server/services/projects';
import { NotFoundError, ValidationError } from '@/server/services/types';
import { makeActor, reset, testDb } from './helpers';
import { scriptedClient, textBlock, toolUse, type ScriptedResponse } from './fakes/anthropic';

const { db, close } = testDb();
afterAll(close);
beforeEach(() => reset(db));

const QUESTIONS = {
  intro: 'Before I design the pricing page, three quick questions:',
  questions: [
    {
      id: 'plans',
      prompt: 'How many plans?',
      kind: 'single',
      options: [
        { id: 'two', label: 'Two' },
        { id: 'three', label: 'Three' },
        { id: 'four', label: 'Four' },
      ],
      allowOther: false,
    },
    {
      id: 'include',
      prompt: 'Anything to include?',
      kind: 'multi',
      options: [
        { id: 'table', label: 'Comparison table' },
        { id: 'faq', label: 'FAQ' },
      ],
      allowOther: true,
    },
  ],
};

const ask: ScriptedResponse = {
  content: [textBlock('A few questions first.'), toolUse('tu_ask', 'ask_followup', QUESTIONS)],
  stopReason: 'tool_use',
};

async function setup(script: ScriptedResponse[]) {
  const actor = await makeActor(db, 'editor');
  const project = await createProject(db, actor, { name: 'P' });
  const client = scriptedClient(script);
  const deps: TurnDeps = {
    proxy: { loadClient: async () => ({ messages: client.messages, provider: 'anthropic' }) },
    flushMs: 0,
    cancelPollMs: 20,
  };
  return { actor, project, client, deps };
}

/** Every tool_use in the request is answered by a tool_result in the next user turn. */
function assertValidHistory(messages: Anthropic.MessageParam[]) {
  messages.forEach((m, i) => {
    if (m.role !== 'assistant' || typeof m.content === 'string') return;
    const ids = m.content.filter((b) => b.type === 'tool_use').map((b) => b.id);
    if (!ids.length) return;
    const next = messages[i + 1];
    expect(next?.role).toBe('user');
    const results = (next!.content as Anthropic.ContentBlockParam[])
      .filter((b) => b.type === 'tool_result')
      .map((b) => b.tool_use_id);
    expect(results.sort()).toEqual(ids.sort());
  });
}

describe('follow-up questions (Story 4.4)', () => {
  it('ends the turn on ask_followup and resumes with the answers', async () => {
    const s = await setup([ask, { content: [textBlock('Designing three plans with an FAQ.')] }]);
    const sent = await sendMessage(db, s.actor, {
      projectId: s.project.id,
      prompt: 'Design a pricing page',
    });
    const asked = await runTurn(db, s.actor, sent.messageId, s.deps);
    expect(asked).toMatchObject({ status: 'complete', toolCalls: [], answers: null });
    expect(asked.questions).toMatchObject({ intro: QUESTIONS.intro });
    expect(asked.questions!.questions.map((q) => q.id)).toEqual(['plans', 'include']);
    // Questions were offered to the model (the tool is in the prefix and not refused).
    expect(JSON.stringify(s.client.calls[0]!.tools)).toContain('"name":"ask_followup"');

    const answered = await answerQuestions(db, s.actor, sent.messageId, {
      answers: [
        { questionId: 'plans', optionIds: ['three'] },
        { questionId: 'include', optionIds: ['faq'], other: 'a toggle' },
      ],
      context: '<document>fresh</document>',
    });
    const reply = await runTurn(db, s.actor, answered.messageId, s.deps);
    expect(reply).toMatchObject({ status: 'complete', text: 'Designing three plans with an FAQ.' });

    const second = s.client.calls[1]!;
    assertValidHistory(second.messages);
    const last = second.messages.at(-1)!.content as Anthropic.ContentBlockParam[];
    expect(last[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_ask' });
    const text = JSON.stringify(last[0]);
    expect(text).toContain('Three');
    expect(text).toContain('FAQ; Other: a toggle');
    // Fresh context follows the tool results.
    expect(last[1]).toEqual({ type: 'text', text: '<document>fresh</document>' });

    const chat = await getProjectChat(db, s.actor, s.project.id);
    const card = chat.messages.find((m) => m.id === sent.messageId)!;
    expect(card.answers).toMatchObject({ outcome: 'answered' });
    const answerMsg = chat.messages.find((m) => m.id === answered.userMessageId)!;
    expect(answerMsg).toMatchObject({ role: 'user', answersFor: sent.messageId });
    expect(answerMsg.text).toContain('How many plans? Three');
  });

  it('"You decide" skips; answering twice, bad answers and viewers are refused', async () => {
    const s = await setup([ask, { content: [textBlock('Going with my defaults.')] }]);
    const sent = await sendMessage(db, s.actor, { projectId: s.project.id, prompt: 'Pricing' });
    await runTurn(db, s.actor, sent.messageId, s.deps);

    const viewer = await makeActor(db, 'viewer', s.actor.workspace);
    const outsider = await makeActor(db, 'editor');
    await expect(
      answerQuestions(db, viewer, sent.messageId, { skip: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      answerQuestions(db, outsider, sent.messageId, { skip: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      answerQuestions(db, s.actor, sent.messageId, {
        answers: [{ questionId: 'plans', optionIds: ['two', 'three'] }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(answerQuestions(db, s.actor, sent.messageId, {})).rejects.toBeInstanceOf(
      ValidationError,
    );

    const skipped = await answerQuestions(db, s.actor, sent.messageId, { skip: true });
    await runTurn(db, s.actor, skipped.messageId, s.deps);
    expect(JSON.stringify(s.client.calls[1]!.messages.at(-1))).toContain('asked you to decide');
    await expect(
      answerQuestions(db, s.actor, sent.messageId, { skip: true }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('a new message instead of answers supersedes the questions', async () => {
    const s = await setup([ask, { content: [textBlock('Sure, smaller headline.')] }]);
    const sent = await sendMessage(db, s.actor, { projectId: s.project.id, prompt: 'Pricing' });
    await runTurn(db, s.actor, sent.messageId, s.deps);

    const next = await sendMessage(db, s.actor, {
      projectId: s.project.id,
      conversationId: sent.conversationId,
      prompt: 'Actually, just make the headline smaller.',
    });
    await runTurn(db, s.actor, next.messageId, s.deps);
    const req = s.client.calls[1]!;
    assertValidHistory(req.messages);
    expect(JSON.stringify(req.messages.at(-1))).toContain('sent a new message instead');
    const chat = await getProjectChat(db, s.actor, s.project.id);
    expect(chat.messages.find((m) => m.id === sent.messageId)!.answers).toMatchObject({
      outcome: 'superseded',
    });
  });

  it('a later turn replays the answered exchange with the call and its result together', async () => {
    const s = await setup([
      ask,
      { content: [textBlock('Done.')] },
      { content: [textBlock('Changed the colour.')] },
    ]);
    const sent = await sendMessage(db, s.actor, { projectId: s.project.id, prompt: 'Pricing' });
    await runTurn(db, s.actor, sent.messageId, s.deps);
    const a = await answerQuestions(db, s.actor, sent.messageId, { skip: true });
    await runTurn(db, s.actor, a.messageId, s.deps);
    const third = await sendMessage(db, s.actor, {
      projectId: s.project.id,
      conversationId: sent.conversationId,
      prompt: 'Make it green',
    });
    await runTurn(db, s.actor, third.messageId, s.deps);
    const req = s.client.calls[2]!;
    assertValidHistory(req.messages);
    expect(req.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
  });
});
