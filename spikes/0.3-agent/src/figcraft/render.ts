/** Render a layer to PNG bytes through the `screenshot` tool (CPU renderer, headless). */
import type { FigcraftSession } from './mcp';

export async function renderPng(
  fc: FigcraftSession,
  id: number,
  opts: { scale?: number; maxSize?: number } = {},
): Promise<Buffer> {
  const r = await fc.call('screenshot', {
    ids: [id],
    scale: opts.scale ?? 1,
    maxSize: opts.maxSize ?? 2600,
  });
  const img = r.content.find((c) => c.type === 'image');
  if (r.isError || !img?.data)
    throw new Error(`screenshot failed: ${r.content.map((c) => c.text).join(' ')}`);
  return Buffer.from(img.data, 'base64');
}
