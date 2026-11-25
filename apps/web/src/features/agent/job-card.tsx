'use client';

/**
 * A background job in the chat (Story 4.5, design 03/4.5): what it was asked for, its progress
 * from the job's event stream (resumable: close the tab and come back), Cancel, and the result.
 * The result is an `agent` version, never the live file: "Open result" opens it in the editor as
 * a second document for review, and "Back to the design" closes it again.
 */
import type { Editor } from '@greenfield/bridge';
import { jobEventsUrl, type JobEvent, type JobEventType } from '@greenfield/contracts';
import { useEditorStore } from '@greenfield/editor-state/react';
import { useEffect, useState } from 'react';
import type { MessageView } from '@/server/services/agent';
import { applyJobEvent, elapsed, INITIAL_JOB, jobEnded, jobStatusLine } from './format';

const EVENT_TYPES: JobEventType[] = [
  'status',
  'progress',
  'log',
  'tool',
  'frame',
  'result',
  'error',
];
const REVIEW = ' · review';

function title(s: MessageView['jobSuggestion']): string {
  switch (s?.kind) {
    case 'alternatives':
      return `${s.count ?? 3} alternatives`;
    case 'redesign':
      return 'Redesign';
    case 'generate':
      return 'New design';
    default:
      return 'Background job';
  }
}

interface Props {
  jobId: string;
  suggestion: MessageView['jobSuggestion'];
  editor: () => Editor | null;
}

export function JobCard({ jobId, suggestion, editor }: Props) {
  const store = useEditorStore();
  const [job, setJob] = useState(INITIAL_JOB);
  const [now, setNow] = useState(() => Date.now());
  const [review, setReview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const ended = jobEnded(job);

  useEffect(() => {
    const es = new EventSource(jobEventsUrl(jobId));
    const on = (e: Event) =>
      setJob((s) => applyJobEvent(s, JSON.parse((e as MessageEvent<string>).data) as JobEvent));
    for (const t of EVENT_TYPES) es.addEventListener(t, on);
    es.addEventListener('done', () => es.close());
    return () => es.close();
  }, [jobId]);

  useEffect(() => {
    if (ended) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ended]);

  // A job that failed before its sandbox reported anything has its reason only on the job.
  const unexplained = job.status === 'failed' && !job.error;
  useEffect(() => {
    if (!unexplained) return;
    fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ error: string | null }>) : null))
      .then((v) => v?.error && setJob((s) => ({ ...s, error: v.error })))
      .catch(() => {});
  }, [unexplained, jobId]);

  const name = title(suggestion);
  const act = (fn: () => Promise<void>) => () => {
    setProblem(null);
    fn().catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  };

  const cancel = act(async () => {
    const r = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
    if (!r.ok) throw new Error(`Cancel failed (${r.status})`);
  });

  const open = act(async () => {
    const ed = editor();
    if (!ed || !job.versionId) return;
    const r = await fetch(`/api/file-versions/${encodeURIComponent(job.versionId)}`);
    if (!r.ok) throw new Error(`The result could not be loaded (${r.status})`);
    const doc = `${name}${REVIEW}`;
    ed.open(`${doc}.figcraft`, await r.arrayBuffer());
    setReview(doc);
  });

  const back = act(async () => {
    const docs = (await store.run('doc.list', {})) as { index: number; name: string }[];
    const shown = docs.find((d) => review && d.name.startsWith(review));
    if (shown) await store.run('file.close', { index: shown.index, force: true });
    setReview(null);
  });

  const tone =
    job.status === 'succeeded' ? 'border-user' : ended ? 'border-border' : 'border-agent';
  return (
    <section
      data-testid="job-card"
      data-status={job.status}
      aria-label={`Job: ${name}`}
      className={`mt-2 border-l-2 ${tone} bg-surface-2 p-3.5 text-[13px]`}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">{name}</h3>
        <span
          data-testid="job-status"
          className={`font-mono text-xs ${job.status === 'succeeded' ? 'text-user' : ended ? 'text-muted' : 'text-agent'}`}
        >
          {jobStatusLine(job)}
          {job.startedAt && ` · ${elapsed(job.startedAt, job.finishedAt ?? now)}`}
        </span>
      </header>
      {suggestion?.prompt && !ended && <p className="mt-1 text-muted">{suggestion.prompt}</p>}
      {job.summary && <p className="mt-1">{job.summary}</p>}
      {job.frames.length > 0 && (
        <ul aria-label="Frames" className="mt-2 space-y-0.5 text-muted">
          {job.frames.map((f, i) => (
            <li key={`${i}:${f}`}>{f}</li>
          ))}
        </ul>
      )}
      {job.error && (
        <p role="alert" className="mt-1 text-danger">
          {job.error}
        </p>
      )}
      {problem && (
        <p role="alert" className="mt-1 text-danger">
          {problem}
        </p>
      )}
      <div className="mt-2 flex gap-3 text-user">
        {!ended && (
          <button type="button" className="btn-link px-0 text-text" onClick={cancel}>
            Cancel
          </button>
        )}
        {job.versionId && !review && (
          <button type="button" className="btn-link px-0 decoration-current" onClick={open}>
            Open result
          </button>
        )}
        {review && (
          <button type="button" className="btn-link px-0 decoration-current" onClick={back}>
            Back to the design
          </button>
        )}
      </div>
    </section>
  );
}
