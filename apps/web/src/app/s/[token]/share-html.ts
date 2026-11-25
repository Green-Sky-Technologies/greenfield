/** HTML for the share viewer's responses (Story 6.3). No app JavaScript, no workspace data. */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Response headers for every share-viewer response (success and failure alike). */
export function shareHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
    'x-robots-tag': 'noindex, nofollow, noarchive',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    // No scripts, images or fonts: the page is a notice with an inline style.
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    ...extra,
  };
}

function page(title: string, body: string): string {
  return (
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>` +
    `<style>body{margin:0;display:grid;place-items:center;min-height:100vh;font:15px/1.5 system-ui,sans-serif;background:#0b0c0a;color:#b9b5ac;color-scheme:dark}h1{color:#ece8de}main{max-width:28rem;padding:24px;text-align:center}a{color:#3fd67f}` +
    `@media (prefers-color-scheme:light){body{background:#f3f0e8;color:#55534c;color-scheme:light}h1{color:#14150f}a{color:#1b733f}}</style>` +
    `</head><body><main><h1 style="font-size:18px">${esc(title)}</h1>${body}</main></body></html>\n`
  );
}

/**
 * A valid link. There is no read-only viewer for FigCraft files yet (Story 1.2 removed the HTML
 * renderer; Epic 3 adds the viewer), so the page says so instead of rendering the design.
 */
export function renderSharePending(): string {
  return page(
    'Shared design',
    `<p>${esc('This link works, but shared designs can’t be viewed yet. The viewer is on its way.')}</p>`,
  );
}

export function renderShareError(opts: {
  status: 404 | 429;
  signInHref?: string;
  retryAfterSec?: number;
}): string {
  const msg =
    opts.status === 429
      ? `Too many requests. Try again in ${opts.retryAfterSec ?? 60} seconds.`
      : 'This link is invalid, has expired, or is only available to members of a workspace.';
  const signIn = opts.signInHref
    ? `<p><a href="${esc(opts.signInHref)}">Sign in</a> if it was shared with your workspace.</p>`
    : '';
  return page('Link unavailable', `<p>${esc(msg)}</p>${signIn}`);
}
