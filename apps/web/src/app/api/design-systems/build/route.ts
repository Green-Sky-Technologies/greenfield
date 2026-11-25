/**
 * Build a design system from sources (Story 10.2).
 *
 * POST /api/design-systems/build <- multipart: name, repo (a public GitHub URL), files (any
 * number of uploads: code, a .zip of code, SVGs) -> progress as NDJSON (`build-stream.ts`), ending
 * with the new system's id. Needs design_system:edit. Upload bodies are never logged.
 */
import { getDb } from '@greenfield/db';
import { apiActor, apiError } from '@/server/api';
import { defaultDesignFileStorage } from '@/server/services/design-files';
import { buildDesignSystem } from '@/server/services/design-systems';
import { ValidationError } from '@/server/services/types';
import { buildStream } from '../build-stream';

export const maxDuration = 120;

/** Uploads in one build (Vercel caps a function body at 4.5 MB anyway). */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const actor = await apiActor();
    if (Number(req.headers.get('content-length') ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024)
      throw new ValidationError(
        'The uploads are too large; upload the code that holds the tokens.',
      );
    const form = await req.formData().catch(() => {
      throw new ValidationError('Invalid form');
    });
    const uploads = await Promise.all(
      form
        .getAll('files')
        .filter((f): f is File => f instanceof File && f.size > 0)
        .map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
    );
    const input = { name: form.get('name'), repo: form.get('repo') ?? undefined, uploads };
    return buildStream(async (onStep) => {
      const { system, version } = await buildDesignSystem(
        getDb(),
        actor,
        defaultDesignFileStorage(),
        input,
        { onStep },
      );
      return { id: system.id, version: version.version };
    });
  } catch (e) {
    return apiError(e);
  }
}
