/**
 * Download the editor zip named by packages/bridge/editor-release.json (Story 8.1).
 *
 * Two pin shapes:
 *   { version, sha256, url }               a public https url, no token needed
 *   { version, sha256, repo, tag, asset }  a release asset of a private GitHub repo, read through
 *                                          the API with EDITOR_RELEASE_TOKEN (a fine-grained token
 *                                          with read-only Contents on that repo)
 *
 * The token goes only in the Authorization header of requests to api.github.com. It is never
 * logged and never put in an error message. Node's fetch drops the header on the cross-origin
 * redirect to the asset's storage, which is what that host needs.
 */

const API = 'https://api.github.com';

/** @returns {string} what the pin points at, safe to print */
export function describePin(pin) {
  return pin.repo ? `${pin.repo} release ${pin.tag} asset ${pin.asset}` : pin.url;
}

/**
 * @param {{ url?: string, repo?: string, tag?: string, asset?: string }} pin
 * @param {{ EDITOR_RELEASE_TOKEN?: string }} env
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<Buffer>}
 */
export async function downloadEditorZip(pin, env, fetchFn = fetch) {
  if (!pin.repo) {
    if (!pin.url)
      throw new Error('editor-release.json needs either "url" or "repo", "tag" and "asset"');
    return read(await fetchFn(pin.url, { redirect: 'follow' }), pin.url);
  }
  if (!pin.tag || !pin.asset)
    throw new Error('editor-release.json: a "repo" pin also needs "tag" and "asset"');
  const token = env.EDITOR_RELEASE_TOKEN?.trim();
  if (!token) {
    throw new Error(
      `The editor is pinned to a private release (${describePin(pin)}) and EDITOR_RELEASE_TOKEN is not set. ` +
        `Set it to a fine-grained token with read-only Contents on ${pin.repo} ` +
        '(Vercel env var and GitHub Actions secret; see packages/bridge/README.md).',
    );
  }
  const auth = { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const releaseUrl = `${API}/repos/${pin.repo}/releases/tags/${encodeURIComponent(pin.tag)}`;
  const rel = await fetchFn(releaseUrl, {
    headers: { ...auth, Accept: 'application/vnd.github+json' },
  });
  if (!rel.ok) throw failed(rel, releaseUrl, pin.repo);
  const release = await rel.json();
  const asset = release.assets?.find((a) => a.name === pin.asset);
  if (!asset) throw new Error(`Release ${pin.tag} of ${pin.repo} has no asset named ${pin.asset}`);
  const assetUrl = `${API}/repos/${pin.repo}/releases/assets/${asset.id}`;
  return read(
    await fetchFn(assetUrl, {
      headers: { ...auth, Accept: 'application/octet-stream' },
      redirect: 'follow',
    }),
    assetUrl,
    pin.repo,
  );
}

async function read(res, url, repo) {
  if (!res.ok) throw failed(res, url, repo);
  return Buffer.from(await res.arrayBuffer());
}

function failed(res, url, repo) {
  const hint =
    repo && (res.status === 401 || res.status === 403 || res.status === 404)
      ? ` (is EDITOR_RELEASE_TOKEN valid, unexpired and allowed to read Contents of ${repo}?)`
      : '';
  return new Error(`Download failed: ${res.status} ${res.statusText} for ${url}${hint}`);
}
