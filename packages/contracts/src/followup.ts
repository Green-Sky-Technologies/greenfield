/**
 * Control tools: calls the model makes to the person, not the editor. The runtime handles them
 * (the interactive loop ends the turn on `ask_followup`, and shows `suggest_generation_job` as an
 * offer); `executeTool` only validates them.
 *
 * - `suggest_generation_job` (Story 4.5): hand a too-big request to a background job.
 *
 * Client-safe (zod only).
 */
import { z } from 'zod';

export const ASK_FOLLOWUP_TOOL = 'ask_followup';
export const SUGGEST_JOB_TOOL = 'suggest_generation_job';

const id = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, 'ids are 1-40 letters, digits, "_" or "-"')
  .describe('Short stable id, e.g. "layout"');

export const questionOption = z
  .object({
    id,
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().max(200).optional(),
  })
  .strict();

export const question = z
  .object({
    id,
    prompt: z.string().trim().min(1).max(300),
    kind: z.enum(['single', 'multi']).describe('single: pick one; multi: pick any'),
    options: z.array(questionOption).min(2).max(6),
    allowOther: z.boolean().describe('Offer a free-text "Other" answer'),
  })
  .strict();

export const askFollowupInput = z
  .object({
    intro: z.string().trim().max(600).optional().describe('One short sentence above the form'),
    questions: z.array(question).min(1).max(5),
  })
  .strict()
  .superRefine((v, ctx) => {
    const qids = new Set<string>();
    v.questions.forEach((q, i) => {
      if (qids.has(q.id))
        ctx.addIssue({ code: 'custom', path: ['questions', i, 'id'], message: 'duplicate id' });
      qids.add(q.id);
      const oids = new Set<string>();
      q.options.forEach((o, j) => {
        if (oids.has(o.id))
          ctx.addIssue({
            code: 'custom',
            path: ['questions', i, 'options', j, 'id'],
            message: 'duplicate option id',
          });
        oids.add(o.id);
      });
    });
  });

export type QuestionSet = z.infer<typeof askFollowupInput>;
export type Question = z.infer<typeof question>;

export const ASK_FOLLOWUP_DESCRIPTION =
  'Ask the user a few multiple-choice follow-up questions, shown as a card in the chat. ' +
  'Calling it ends your turn; the user\'s answers (or "You decide") come back as this tool\'s result and you then continue. ' +
  'Call it first, before suggest_generation_job, when the user asks for a new design, page or screen. ' +
  'For edits to existing layers, call it only when the request is genuinely ambiguous or large; never for small tweaks. ' +
  'Ask 1-5 questions (purpose, audience, content, layout, visual style, sections), each with 2-6 concrete options. ' +
  'Use kind "multi" when several options can apply, and allowOther when the options might not cover it. ' +
  'Call it at most once per turn, alone, and do not ask again about things already answered.';

/** One answered question. `optionIds` are option ids; `other` is the free-text "Other". */
export const questionAnswer = z
  .object({
    questionId: id,
    optionIds: z.array(id).max(6),
    other: z.string().trim().max(1000).optional(),
  })
  .strict();
export type QuestionAnswer = z.infer<typeof questionAnswer>;

/**
 * What the user did with a question set: `ask_followup`'s result. `skipped` is "You decide";
 * `superseded` means they sent a new message instead.
 */
export const askFollowupOutput = z
  .object({
    outcome: z.enum(['answered', 'skipped', 'superseded']),
    answers: z.array(questionAnswer).max(5),
  })
  .strict();

export const JOB_SUGGESTION_KINDS = ['generate', 'redesign', 'alternatives'] as const;

export const suggestJobInput = z
  .object({
    kind: z
      .enum(JOB_SUGGESTION_KINDS)
      .describe(
        'generate: new pages or screens; redesign: rework whole frames; alternatives: N variants',
      ),
    prompt: z.string().min(1).max(4000).describe('A detailed brief for the job'),
    frameIds: z
      .array(z.string())
      .max(20)
      .optional()
      .describe('Layer ids of the frames to redesign or vary'),
    count: z.number().int().min(2).max(5).optional().describe('How many alternatives'),
    reason: z.string().max(400).describe('One sentence for the user: why this is a job'),
  })
  .strict();
export type JobSuggestion = z.infer<typeof suggestJobInput>;

export const SUGGEST_JOB_DESCRIPTION =
  'Offer the user a background generation job instead of editing now. Use it when the request needs new pages or screens, a redesign of whole frames, or several alternatives. ' +
  'The user decides whether to start it; make no edits for this request yourself.';

/** The tool_result text once the offer is shown. */
export const SUGGEST_JOB_RESULT =
  'Shown to the user as an offer to start a background job. Do not make edits for this request now.';

export const suggestJobOutput = z.object({ status: z.literal('offered') }).strict();
