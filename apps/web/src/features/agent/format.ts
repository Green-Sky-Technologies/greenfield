/**
 * What the agent pane says about a turn, as plain functions: the change list's rows (Story 4.7),
 * a tool call's line in the activity list, a job's state from its events (Story 4.5), and the
 * model's short name.
 */
import type { JobEvent, JobStatus, LayerChange } from '@greenfield/contracts';

export interface ChangeRow {
  key: string;
  layer: string;
  what: string;
}

/** `fontSize` → `font size`. */
const words = (field: string) => field.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

/** A property value, short: colours and numbers as they are, paint lists by their colour. */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'none';
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (typeof v === 'string') return v.length > 32 ? `${v.slice(0, 31)}…` : v;
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (Array.isArray(v)) {
    if (!v.length) return 'none';
    const colours = v.map((p) => (p as { color?: unknown } | null)?.color);
    if (colours.every((c) => typeof c === 'string')) return colours.join(', ');
    if (v.every((x) => typeof x === 'number')) return v.map(formatValue).join(', ');
    return `${v.length} items`;
  }
  const json = JSON.stringify(v);
  return json.length > 32 ? `${json.slice(0, 31)}…` : json;
}

/** One row per changed property, one per added or removed layer, in the turn's order. */
export function changeRows(changes: readonly LayerChange[]): ChangeRow[] {
  return changes.flatMap((c): ChangeRow[] => {
    const layer = c.name || `Layer ${c.id}`;
    if (c.kind !== 'changed') return [{ key: `${c.id}`, layer, what: c.kind }];
    return c.fields.map((f) => ({
      key: `${c.id}:${f.field}`,
      layer,
      what: `${words(f.field)} ${formatValue(f.before)} → ${formatValue(f.after)}`,
    }));
  });
}

interface CallLike {
  name: string;
  input: unknown;
}

/** A tool call as a line of the turn's activity: the batch's own label for edits. */
export function activityLabel(call: CallLike, checking = false): string {
  const input = (call.input ?? {}) as { label?: unknown; id?: unknown };
  switch (call.name) {
    case 'run_batch':
      return typeof input.label === 'string' && input.label ? input.label : 'Edit layers';
    case 'render':
      return checking ? 'Check the result' : 'Look at the frame';
    case 'get_node':
      return 'Read a layer';
    case 'get_outline':
      return 'Read the page';
    case 'get_selection':
      return 'Read the selection';
    case 'list_commands':
      return 'Look up editor commands';
    case 'comment_thread':
      return 'Comment';
    default:
      return call.name.replaceAll('_', ' ');
  }
}

/** `claude-sonnet-5-5` → `Sonnet`. */
export function modelName(model: string | null | undefined): string | null {
  const m = model?.match(/claude-([a-z]+)/);
  return m ? m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1) : null;
}

export interface JobState {
  status: JobStatus;
  /** The sandbox's last progress report: `preparing`, `agent_started`, `editing`, `saving`. */
  phase: string | null;
  /** Edits made so far (`editing` reports). */
  batches: number;
  startedAt: string | null;
  finishedAt: string | null;
  summary: string | null;
  frames: string[];
  versionId: string | null;
  error: string | null;
}

export const INITIAL_JOB: JobState = {
  status: 'queued',
  phase: null,
  batches: 0,
  startedAt: null,
  finishedAt: null,
  summary: null,
  frames: [],
  versionId: null,
  error: null,
};

const TERMINAL = new Set<JobStatus>(['succeeded', 'failed', 'cancelled']);
export const jobEnded = (s: JobState) => TERMINAL.has(s.status);

/** Fold one event of a job's stream (`/api/jobs/:id/events`) into its state. */
export function applyJobEvent(s: JobState, e: JobEvent): JobState {
  const d = e.data;
  switch (e.type) {
    case 'status': {
      const status = d.status as JobStatus;
      return {
        ...s,
        status,
        startedAt: s.startedAt ?? e.createdAt,
        ...(TERMINAL.has(status) ? { finishedAt: e.createdAt } : {}),
      };
    }
    case 'progress':
      return {
        ...s,
        phase: typeof d.phase === 'string' ? d.phase : s.phase,
        batches: typeof d.batches === 'number' ? d.batches : s.batches,
      };
    case 'frame':
      return typeof d.name === 'string' ? { ...s, frames: [...s.frames, d.name] } : s;
    case 'result': {
      const frames = Array.isArray(d.frames)
        ? d.frames
            .map((f) => (f as { name?: unknown } | null)?.name)
            .filter((n): n is string => typeof n === 'string')
        : [];
      return {
        ...s,
        summary: typeof d.summary === 'string' ? d.summary : null,
        frames: [...s.frames, ...frames],
        versionId: typeof d.versionId === 'string' ? d.versionId : null,
      };
    }
    case 'error':
      return { ...s, error: typeof d.message === 'string' ? d.message : 'The job failed' };
    default:
      return s;
  }
}

const PHASES: Record<string, string> = {
  preparing: 'Preparing a copy of the file',
  agent_started: 'Claude is reading the file',
  editing: 'Designing',
  saving: 'Saving the result',
};

/** The job's status line: what it is doing now. */
export function jobStatusLine(s: JobState): string {
  switch (s.status) {
    case 'queued':
      return 'Waiting to start';
    case 'provisioning':
      return 'Starting a sandbox';
    case 'running': {
      const phase = (s.phase && PHASES[s.phase]) ?? 'Running';
      return s.batches ? `${phase} · ${s.batches} edit${s.batches === 1 ? '' : 's'} so far` : phase;
    }
    case 'succeeded':
      return 'Done';
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return 'Failed';
  }
}

/** `1m 52s` between two instants. */
export function elapsed(from: string, to: number | string): string {
  const ms = (typeof to === 'number' ? to : Date.parse(to)) - Date.parse(from);
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
