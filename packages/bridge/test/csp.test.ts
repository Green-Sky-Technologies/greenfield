import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EMBEDDING_PAGE_CSP, editorCsp, inlineHashes } from '../src/csp';
import { EDITOR_RELEASE_SHA256, EDITOR_VERSION } from '../src/generated/commands';

const sha = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;

describe('editor version pin', () => {
  it('fetch-editor.mjs and the generated bridge types pin the same release', () => {
    const pin = JSON.parse(
      readFileSync(new URL('../editor-release.json', import.meta.url), 'utf8'),
    ) as { version: string; sha256: string };
    expect({ version: EDITOR_VERSION, sha256: EDITOR_RELEASE_SHA256 }).toEqual(pin);
  });
});

describe('editor CSP', () => {
  const html = `<!DOCTYPE html><head>
<script type="module">import init from './a.js';</script>
<script src="./b.js"></script>
<style>body { margin: 0 }</style>
</head>`;

  it('hashes inline blocks only', () => {
    expect(inlineHashes(html)).toEqual({
      scripts: [sha("import init from './a.js';")],
      styles: [sha('body { margin: 0 }')],
    });
  });

  it("allows WebAssembly and the page's own inline blocks, nothing else", () => {
    const csp = editorCsp(html);
    expect(csp).toContain(
      `script-src 'self' 'wasm-unsafe-eval' ${sha("import init from './a.js';")}`,
    );
    expect(csp).toContain(`style-src 'self' ${sha('body { margin: 0 }')}`);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toMatch(/'unsafe-eval'|'unsafe-inline'|https?:|\*/);
  });

  it('embedding pages frame only the app origin', () => {
    expect(EMBEDDING_PAGE_CSP).toContain("frame-src 'self'");
    expect(EMBEDDING_PAGE_CSP).not.toMatch(/script-src|unsafe/);
  });
});
