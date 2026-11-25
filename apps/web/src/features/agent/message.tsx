'use client';

/**
 * One message of the project chat (Story 5.2, designs 02/5.5 and 02/4.7): yours, in green, with
 * the selection it was sent with; Claude's, in ember, with what it is doing step by step while
 * the turn runs, then what it changed, its questions, or the job it offered or started.
 */
import type { Editor } from '@greenfield/bridge';
import { DesignCheckCard } from '@/features/design-systems/check-card';
import type { MessageView } from '@/server/services/agent';
import { ChangeList } from './change-list';
import { JobCard } from './job-card';
import { QuestionCard } from './question-card';
import { SelectionChip } from './selection-chip';
import { isRunning, sentScope, type ActivityItem, type AgentChat } from './use-agent-chat';

export function UserMessage({ message, name }: { message: MessageView; name: string }) {
  const scope = sentScope(message);
  return (
    <li data-testid="agent-message" data-role="user" className="space-y-1.5">
      <p className="type-label text-user">{name}</p>
      <p className="whitespace-pre-wrap">{message.text}</p>
      {scope && !message.answersFor && <SelectionChip ids={scope} />}
    </li>
  );
}

const MARK: Record<ActivityItem['status'], string> = {
  done: '✓',
  running: '',
  error: '×',
};

function Activity({ items }: { items: ActivityItem[] }) {
  return (
    <ul aria-label="Steps" className="space-y-2 text-[13px]">
      {items.map((a) => (
        <li key={a.id} data-status={a.status} className="flex items-start gap-2.5">
          <span
            aria-hidden
            className={`mt-0.5 flex size-3.5 shrink-0 items-center justify-center text-xs leading-none ${
              a.status === 'running'
                ? 'border border-agent'
                : a.status === 'done'
                  ? 'text-user'
                  : 'text-danger'
            }`}
          >
            {MARK[a.status]}
          </span>
          <span className={a.status === 'done' ? 'text-muted' : undefined}>{a.label}</span>
        </li>
      ))}
    </ul>
  );
}

interface ClaudeProps {
  message: MessageView;
  /** The message it answers. */
  asked: MessageView | undefined;
  chat: AgentChat;
  editor: () => Editor | null;
}

export function ClaudeMessage({ message: m, asked, chat, editor }: ClaudeProps) {
  const running = isRunning(m);
  const steps = chat.activity[m.id] ?? [];
  const changed = new Set(m.changes.map((c) => c.id)).size;
  const canRetry =
    (m.status === 'error' || m.status === 'cancelled') && !!asked && !asked.answersFor;
  return (
    <li
      data-testid="agent-message"
      data-role="assistant"
      data-status={m.status}
      className="space-y-2"
    >
      <p className="type-label text-agent">Claude</p>
      {m.text ? (
        <p className="whitespace-pre-wrap">{m.text}</p>
      ) : (
        running && <p className="text-muted">Working…</p>
      )}
      {steps.length > 0 && (running || !m.changes.length) && <Activity items={steps} />}
      {running && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span aria-hidden className="size-1.5 bg-agent" />
          <span data-testid="turn-progress" className="flex-1">
            {m.checking ? 'Checking the result' : 'Working'}
            {changed > 0 && ` · ${changed} layer${changed === 1 ? '' : 's'} changed so far`}
          </span>
          <button
            type="button"
            className="btn-ghost px-2.5 py-0.5 text-xs"
            onClick={() => chat.cancel(m.id)}
          >
            Stop
          </button>
        </div>
      )}
      {m.status === 'cancelled' && <p className="text-xs text-muted">Stopped.</p>}
      {m.error && (
        <p role="alert" className="text-xs text-danger">
          {m.error}
        </p>
      )}
      {canRetry && (
        <button
          type="button"
          className="btn-link px-0 text-xs"
          disabled={chat.sending || chat.running}
          onClick={() => chat.retry(m)}
        >
          Retry
        </button>
      )}
      {m.questions && (
        <QuestionCard
          set={m.questions}
          answers={m.answers}
          disabled={chat.sending}
          onAnswer={(a) => chat.answer(m, a)}
        />
      )}
      {m.jobSuggestion && !m.jobId && (
        <div className="border-l-2 border-agent bg-surface-2 p-3.5 text-[13px]">
          <p>{m.jobSuggestion.reason}</p>
          <button
            type="button"
            className="btn-primary mt-2 px-3 py-1"
            disabled={chat.sending}
            onClick={() => chat.startJob(m)}
          >
            Start the job
          </button>
        </div>
      )}
      {m.jobId && <JobCard jobId={m.jobId} suggestion={m.jobSuggestion} editor={editor} />}
      {!running && m.changes.length > 0 && <ChangeList reply={m} onUndo={() => chat.revert(m)} />}
      {!running && m.designCheck && <DesignCheckCard check={m.designCheck} />}
    </li>
  );
}
