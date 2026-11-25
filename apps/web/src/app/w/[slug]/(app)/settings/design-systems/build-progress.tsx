'use client';

import { useState } from 'react';
import type { BuildLine } from '@/app/api/design-systems/build-stream';

const STEPS = [
  { step: 'sources', label: 'Reading sources' },
  { step: 'colours', label: 'Colours' },
  { step: 'type', label: 'Type' },
  { step: 'scales', label: 'Spacing and radius scales' },
  { step: 'components', label: 'Components' },
  { step: 'guide', label: 'Writing the guide for Claude' },
] as const;

type Step = (typeof STEPS)[number]['step'];

/** Run a build request and follow its NDJSON progress (Story 10.2). */
export function useBuild() {
  const [done, setDone] = useState<Partial<Record<Step, string>>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(
    request: () => Promise<Response>,
  ): Promise<{ id: string; version: number } | null> {
    setDone({});
    setError(null);
    setRunning(true);
    try {
      const res = await request().catch(() => null);
      if (!res) throw new Error('The build could not start. Check your connection.');
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'The build could not start.');
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      let result: { id: string; version: number } | null = null;
      // Read to the end of the stream (`done` is its last line), so it closes cleanly.
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        buffer += value;
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = JSON.parse(buffer.slice(0, nl)) as BuildLine;
          buffer = buffer.slice(nl + 1);
          if (line.type === 'step') setDone((d) => ({ ...d, [line.step]: line.text }));
          else if (line.type === 'error') throw new Error(line.message);
          else result = { id: line.id, version: line.version };
        }
      }
      if (!result) throw new Error('The build stopped before it finished.');
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The build failed.');
      return null;
    } finally {
      setRunning(false);
    }
  }
  return { run, done, running, error };
}

/** The design's "Building" panel: a bar and one line per step. */
export function BuildProgress({
  name,
  done,
  running,
  error,
}: {
  name: string;
  done: Partial<Record<Step, string>>;
  running: boolean;
  error: string | null;
}) {
  const count = STEPS.filter((s) => done[s.step]).length;
  return (
    <section aria-label="Build progress" className="flex flex-col gap-4">
      <div>
        <p className="type-label text-agent">
          {error ? 'Stopped' : count === STEPS.length ? 'Built' : 'Building'}
        </p>
        <p className="mt-2 text-lg">{name || 'New design system'}</p>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={STEPS.length}
        aria-valuenow={count}
        className="h-1 w-full bg-surface-2"
      >
        <div
          className="h-full bg-agent transition-[width]"
          style={{ width: `${(count / STEPS.length) * 100}%` }}
        />
      </div>
      <ol className="flex flex-col gap-3 text-sm">
        {STEPS.map(({ step, label }, i) => {
          const text = done[step];
          const current = running && !text && i === count;
          return (
            <li key={step} data-step={step} data-done={!!text} className="flex items-start gap-3">
              <span
                aria-hidden
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border text-[11px] ${
                  text ? 'border-transparent text-ok' : current ? 'border-agent' : 'border-border'
                }`}
              >
                {text ? '✓' : ''}
              </span>
              <span className={text ? '' : 'text-muted'}>{text ?? label}</span>
            </li>
          );
        })}
      </ol>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
