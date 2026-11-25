/**
 * A new version of a system from an uploaded library file (Story 10.6).
 *
 * POST /api/design-systems/:systemId/versions <- the raw `.figcraft` bytes -> 201 { version }
 *
 * Needs design_system:edit. The version is reviewed and published like the first one; files that
 * use the system update when an admin updates them. Bodies are never logged.
 */
import { getDb } from '@greenfield/db';
import { NextResponse } from 'next/server';
import { apiActor, apiError } from '@/server/api';
import { defaultDesignFileStorage, MAX_DESIGN_FILE_BYTES } from '@/server/services/design-files';
import { uploadDesignSystemVersion } from '@/server/services/design-systems';
import { ValidationError } from '@/server/services/types';

export async function POST(
  req: Request,
  ctx: RouteContext<'/api/design-systems/[systemId]/versions'>,
) {
  try {
    const actor = await apiActor();
    const { systemId } = await ctx.params;
    const declared = Number(req.headers.get('content-length') ?? NaN);
    if (declared > MAX_DESIGN_FILE_BYTES) throw new ValidationError('File too large');
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (Number.isFinite(declared) && declared !== bytes.byteLength)
      throw new ValidationError('Incomplete upload');
    const v = await uploadDesignSystemVersion(getDb(), actor, defaultDesignFileStorage(), {
      systemId,
      bytes,
    });
    return NextResponse.json({ version: v.version }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
