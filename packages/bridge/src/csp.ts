/**
 * Content security policies for serving the editor (Story 8.1). Node only: the app's
 * `next.config.ts` and the bridge's test server send the same headers.
 *
 * The editor page allows its own files, its two inline blocks (by hash) and WebAssembly
 * compilation (`'wasm-unsafe-eval'`), and nothing else: no `eval`, no other origins, no
 * connections off the app's origin. The pages that embed it may frame only our own origin.
 */
import { createHash } from 'node:crypto';

const hash = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

/** Hashes of the inline `<script>` and `<style>` blocks in the editor's index.html. */
export function inlineHashes(indexHtml: string): { scripts: string[]; styles: string[] } {
  const blocks = (tag: string) =>
    [...indexHtml.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi'))]
      .filter((m) => !/\ssrc=/i.test(m[1] ?? ''))
      .map((m) => hash(m[2]!));
  return { scripts: blocks('script'), styles: blocks('style') };
}

/**
 * The empty stylesheet Playwright adds to every frame of a WebKit page to settle animations before
 * a screenshot. It styles nothing; allowing it keeps the e2e suites' strict CSP check meaningful
 * in WebKit.
 */
export const SCREENSHOT_SYNC_STYLE = 'body {}';

/** The policy for everything under `/editor/`, from the pinned release's index.html. */
export function editorCsp(indexHtml: string): string {
  const { scripts, styles } = inlineHashes(indexHtml);
  return [
    "default-src 'self'",
    ["script-src 'self' 'wasm-unsafe-eval'", ...scripts].join(' '),
    ["style-src 'self'", ...styles, hash(SCREENSHOT_SYNC_STYLE)].join(' '),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join('; ');
}

/** The policy for app pages that embed the editor: frames from our own origin only. */
export const EMBEDDING_PAGE_CSP = "frame-src 'self'; object-src 'none'; frame-ancestors 'self'";
