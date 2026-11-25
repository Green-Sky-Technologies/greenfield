'use client';

/**
 * Claude's follow-up questions as a card (Story 4.4, design 03/4.4): one group per question
 * (pick one, or several for a `multi` question), a free-text answer where Claude allows one,
 * "You decide" to let Claude choose, and Send. Once answered, the card shows what was chosen.
 */
import type { Question, QuestionAnswer, QuestionSet } from '@greenfield/contracts';
import { useState } from 'react';
import type { MessageView } from '@/server/services/agent';

interface Props {
  set: QuestionSet;
  answers: MessageView['answers'];
  disabled: boolean;
  onAnswer: (answers: QuestionAnswer[] | 'skip') => void;
}

type Picks = Record<string, { optionIds: string[]; other: string }>;

export function QuestionCard({ set, answers, disabled, onAnswer }: Props) {
  const [picks, setPicks] = useState<Picks>({});
  const done = !!answers;
  const pick = (q: Question, optionId: string) =>
    setPicks((p) => {
      const cur = p[q.id] ?? { optionIds: [], other: '' };
      const on = cur.optionIds.includes(optionId);
      const optionIds =
        q.kind === 'multi'
          ? on
            ? cur.optionIds.filter((o) => o !== optionId)
            : [...cur.optionIds, optionId]
          : on
            ? []
            : [optionId];
      return { ...p, [q.id]: { ...cur, optionIds } };
    });
  const chosen = (q: Question): QuestionAnswer | undefined => {
    if (done) return answers.answers.find((a) => a.questionId === q.id);
    const p = picks[q.id];
    return p && { questionId: q.id, optionIds: p.optionIds, other: p.other };
  };
  const given: QuestionAnswer[] = set.questions.flatMap((q) => {
    const p = picks[q.id];
    const other = p?.other.trim();
    if (!p || (!p.optionIds.length && !other)) return [];
    return [{ questionId: q.id, optionIds: p.optionIds, ...(other ? { other } : {}) }];
  });

  return (
    <form
      data-testid="question-card"
      aria-label="Claude’s questions"
      className="mt-2 border-l-2 border-agent bg-surface-2 p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        onAnswer(given);
      }}
    >
      {set.intro && <p className="mb-3 text-[13px]">{set.intro}</p>}
      {set.questions.map((q) => {
        const a = chosen(q);
        return (
          <fieldset key={q.id} disabled={done || disabled} className="mb-3">
            <legend className="type-label mb-2 text-muted">{q.prompt}</legend>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((o) => {
                const on = !!a?.optionIds.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={on}
                    title={o.description}
                    onClick={() => pick(q, o.id)}
                    className={`shell-focus border px-3 py-1 text-[13px] ${
                      on
                        ? 'border-text bg-text font-medium text-bg'
                        : 'border-border text-text hover:border-muted'
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            {q.allowOther && (
              <input
                aria-label={`${q.prompt} (your own answer)`}
                className="input mt-1.5 py-1.5 text-[13px]"
                placeholder="Something else…"
                value={done ? (a?.other ?? '') : (picks[q.id]?.other ?? '')}
                onChange={(e) =>
                  setPicks((p) => ({
                    ...p,
                    [q.id]: { optionIds: p[q.id]?.optionIds ?? [], other: e.target.value },
                  }))
                }
              />
            )}
          </fieldset>
        );
      })}
      {done ? (
        <p data-testid="question-outcome" className="text-xs text-muted">
          {answers.outcome === 'answered'
            ? 'Answered.'
            : answers.outcome === 'skipped'
              ? 'You let Claude decide.'
              : 'Skipped: you sent a new message.'}
        </p>
      ) : (
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="btn-link text-[13px] text-muted"
            disabled={disabled}
            onClick={() => onAnswer('skip')}
          >
            You decide
          </button>
          <button
            type="submit"
            className="btn-primary px-3 py-1"
            disabled={disabled || !given.length}
          >
            Send answers
          </button>
        </div>
      )}
    </form>
  );
}
