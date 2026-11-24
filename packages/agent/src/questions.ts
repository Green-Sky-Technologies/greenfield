/**
 * Follow-up questions before designing: the interactive agent's `ask_followup` tool (Story 4.4).
 *
 * The model calls it with a small form (1–5 multiple-choice questions, optional "Other" text).
 * Calling it ends the turn; the tool_result stays pending until the user answers, then the
 * answers go back as that tool_result and the agent continues. The input and answer schemas
 * are part of the tool contract (`@greenfield/contracts`); this module validates and formats
 * answers.
 *
 * Client-safe (zod only): the browser imports this through `@greenfield/agent/questions`.
 */
import {
  ASK_FOLLOWUP_DESCRIPTION,
  ASK_FOLLOWUP_TOOL,
  askFollowupInput,
  question,
  questionAnswer,
  questionOption,
  type Question,
  type QuestionAnswer,
  type QuestionSet,
} from '@greenfield/contracts';
import { z } from 'zod';

export {
  ASK_FOLLOWUP_DESCRIPTION,
  ASK_FOLLOWUP_TOOL,
  askFollowupInput,
  question,
  questionAnswer,
  questionOption,
  type Question,
  type QuestionAnswer,
  type QuestionSet,
};

/** The request body for answering a question set. `skip`: "just decide". */
export const answerQuestionsInput = z
  .object({
    skip: z.boolean().optional(),
    answers: z.array(questionAnswer).max(5).default([]),
    model: z.string().max(100).optional(),
  })
  .strict();
export type AnswerQuestionsInput = z.input<typeof answerQuestionsInput>;

/** What the user did with a question set (stored on the asking message). */
export interface QuestionAnswers {
  /** 'answered', 'skipped' ("just decide"), or 'superseded' (they sent a new message instead). */
  outcome: 'answered' | 'skipped' | 'superseded';
  answers: QuestionAnswer[];
  answeredBy?: string;
  answeredAt?: string;
}

export class AnswerError extends Error {
  override name = 'AnswerError';
}

/**
 * Check answers against the question set and normalize them (question order, empty entries
 * dropped, an empty "Other" removed). Throws AnswerError on anything that doesn't fit.
 */
export function validateAnswers(set: QuestionSet, answers: QuestionAnswer[]): QuestionAnswer[] {
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  if (byId.size !== answers.length) throw new AnswerError('Each question can be answered once');
  for (const a of answers)
    if (!set.questions.some((q) => q.id === a.questionId))
      throw new AnswerError(`Unknown question: ${a.questionId}`);
  const out: QuestionAnswer[] = [];
  for (const q of set.questions) {
    const a = byId.get(q.id);
    if (!a) continue;
    const optionIds = [...new Set(a.optionIds)];
    for (const o of optionIds)
      if (!q.options.some((x) => x.id === o))
        throw new AnswerError(`Unknown option "${o}" for "${q.prompt}"`);
    const other = a.other?.trim() || undefined;
    if (other && !q.allowOther) throw new AnswerError(`"${q.prompt}" has no "Other" answer`);
    if (q.kind === 'single' && optionIds.length + (other ? 1 : 0) > 1)
      throw new AnswerError(`Pick one answer for "${q.prompt}"`);
    if (!optionIds.length && !other) continue;
    out.push(other ? { questionId: q.id, optionIds, other } : { questionId: q.id, optionIds });
  }
  return out;
}

/** Labels chosen for one question, with "Other" text last. */
export function answerLabels(q: Question, a: QuestionAnswer | undefined): string[] {
  if (!a) return [];
  const labels = q.options.filter((o) => a.optionIds.includes(o.id)).map((o) => o.label);
  if (a.other) labels.push(`Other: ${a.other}`);
  return labels;
}

/** The tool_result text the model receives. */
export function formatAnswersForModel(set: QuestionSet, result: QuestionAnswers): string {
  if (result.outcome === 'superseded')
    return 'The user did not answer these questions and sent a new message instead (it follows). Treat the questions as unanswered and respond to the new message.';
  if (result.outcome === 'skipped')
    return 'The user skipped the questions and asked you to decide. Use your own judgement for every question and carry on with the request now, without asking again.';
  const byId = new Map(result.answers.map((a) => [a.questionId, a]));
  const lines = set.questions.map((q, i) => {
    const labels = answerLabels(q, byId.get(q.id));
    return `${i + 1}. ${q.prompt}\n   Answer: ${labels.length ? labels.join('; ') : 'no preference (use your judgement)'}`;
  });
  return `The user answered your questions:\n${lines.join('\n')}\n\nCarry on with the request now using these answers; don't ask again about them. If this is a new design, call suggest_generation_job with a detailed brief that includes the answers.`;
}

/** Short one-line summary (stored as the answer message's text, shown in collapsed cards). */
export function answersSummary(set: QuestionSet, result: QuestionAnswers): string {
  if (result.outcome === 'skipped') return 'Skipped the questions: use your judgement.';
  if (result.outcome === 'superseded') return 'Not answered.';
  const byId = new Map(result.answers.map((a) => [a.questionId, a]));
  return set.questions
    .map((q) => {
      const labels = answerLabels(q, byId.get(q.id));
      return labels.length ? `${q.prompt} ${labels.join(', ')}` : null;
    })
    .filter(Boolean)
    .join('\n');
}
