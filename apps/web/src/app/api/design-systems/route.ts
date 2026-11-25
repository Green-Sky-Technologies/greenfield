/**
 * Create a design system from an uploaded library file (Story 10.1, the manual path).
 *
 * POST /api/design-systems?name=<name> <- the raw `.figcraft` bytes -> 201 { id }
 *
 * Needs design_system:edit. On Vercel a function body caps at 4.5 MB, which a hand-made library
 * fits; bigger libraries come from the builder (10.2), which writes them server-side.
 * Bodies are never logged.
 */
import { getDb } from '@greenfield/db';
import { NextResponse, type NextRequest } from 'next/server';
import { apiActor, apiError } from '@/server/api';
import { defaultDesignFileStorage, MAX_DESIGN_FILE_BYTES } from '@/server/services/design-files';
import { createDesignSystem } from '@/server/services/design-systems';
import { ValidationError } from '@/server/services/types';

export async function POST(req: NextRequest) {
  try {
    const actor = await apiActor();
    const declared = Number(req.headers.get('content-length') ?? NaN);
    if (declared > MAX_DESIGN_FILE_BYTES) throw new ValidationError('File too large');
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (Number.isFinite(declared) && declared !== bytes.byteLength)
      throw new ValidationError('Incomplete upload');
    const { system } = await createDesignSystem(getDb(), actor, defaultDesignFileStorage(), {
      name: req.nextUrl.searchParams.get('name'),
      bytes,
    });
    return NextResponse.json({ id: system.id }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
