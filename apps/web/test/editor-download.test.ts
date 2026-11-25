import { describe, expect, it } from 'vitest';
import { downloadEditorZip } from '../scripts/editor-download.mjs';

const TOKEN = 'github_pat_SECRET';
const PRIVATE = { repo: 'Org/private-editor', tag: 'editor-abc', asset: 'site.zip' };

type Call = { url: string; headers: Record<string, string> };

/** A fetch that answers the GitHub API shapes and records what it was asked. */
function fakeFetch(opts: { assetName?: string; status?: number } = {}) {
  const calls: Call[] = [];
  const fn = async (url: string, init: { headers?: Record<string, string> } = {}) => {
    calls.push({ url, headers: init.headers ?? {} });
    if (opts.status) return new Response('nope', { status: opts.status, statusText: 'Nope' });
    if (url.endsWith('/releases/tags/editor-abc'))
      return Response.json({ assets: [{ id: 42, name: opts.assetName ?? 'site.zip' }] });
    if (url.endsWith('/releases/assets/42')) return new Response('zip-bytes');
    return new Response('public-bytes');
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

describe('downloadEditorZip', () => {
  it('downloads a public url pin with no token and no Authorization header', async () => {
    const { fn, calls } = fakeFetch();
    const zip = await downloadEditorZip({ url: 'https://example.com/e.zip' }, {}, fn);
    expect(zip.toString()).toBe('public-bytes');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers).toEqual({});
  });

  it('reads a private release asset through the API with the token', async () => {
    const { fn, calls } = fakeFetch();
    const zip = await downloadEditorZip(PRIVATE, { EDITOR_RELEASE_TOKEN: TOKEN }, fn);
    expect(zip.toString()).toBe('zip-bytes');
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.github.com/repos/Org/private-editor/releases/tags/editor-abc',
      'https://api.github.com/repos/Org/private-editor/releases/assets/42',
    ]);
    expect(calls[1]!.headers.Accept).toBe('application/octet-stream');
    for (const c of calls) expect(c.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('fails with a clear message when the token is missing, without calling out', async () => {
    const { fn, calls } = fakeFetch();
    await expect(downloadEditorZip(PRIVATE, {}, fn)).rejects.toThrow(
      /EDITOR_RELEASE_TOKEN is not set/,
    );
    await expect(downloadEditorZip(PRIVATE, { EDITOR_RELEASE_TOKEN: '  ' }, fn)).rejects.toThrow(
      /EDITOR_RELEASE_TOKEN is not set/,
    );
    expect(calls).toHaveLength(0);
  });

  it('names a missing asset, and never puts the token in an error', async () => {
    const missing = fakeFetch({ assetName: 'other.zip' });
    await expect(
      downloadEditorZip(PRIVATE, { EDITOR_RELEASE_TOKEN: TOKEN }, missing.fn),
    ).rejects.toThrow(/no asset named site\.zip/);
    const denied = fakeFetch({ status: 404 });
    const err = await downloadEditorZip(PRIVATE, { EDITOR_RELEASE_TOKEN: TOKEN }, denied.fn).catch(
      (e: Error) => e,
    );
    expect(String(err)).toMatch(/404.*Contents of Org\/private-editor/);
    expect(String(err)).not.toContain(TOKEN);
  });
});
