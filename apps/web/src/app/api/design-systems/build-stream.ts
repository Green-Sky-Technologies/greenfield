/**
 * A build (Story 10.2) answers with its progress as it happens: newline-delimited JSON, one
 * `{ type: 'step', step, text }` per step, then `{ type: 'done', id, version }` or
 * `{ type: 'error', status, message }`. Errors before the first step are plain JSON responses.
 */
import { apiError } from '@/server/api';
import type { BuildStep } from '@/server/services/design-systems';

export type BuildLine =
  | ({ type: 'step' } & BuildStep)
  | { type: 'done'; id: string; version: number }
  | { type: 'error'; status: number; message: string };

export function buildStream(
  run: (onStep: (s: BuildStep) => void) => Promise<{ id: string; version: number }>,
): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: BuildLine) => controller.enqueue(enc.encode(`${JSON.stringify(line)}\n`));
      try {
        send({ type: 'done', ...(await run((s) => send({ type: 'step', ...s }))) });
      } catch (e) {
        const res = apiError(e);
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        send({ type: 'error', status: res.status, message: body.message ?? 'Build failed' });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}
