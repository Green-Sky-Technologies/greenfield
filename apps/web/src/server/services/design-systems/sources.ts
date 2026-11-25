/**
 * The sources a design system is built from (Story 10.2): a public GitHub repository, or
 * uploaded files (code, a `.zip` of code, SVGs). Only text files that can hold design tokens or
 * components are kept; nothing is executed.
 *
 * A repository is read from GitHub's tarball endpoint (`codeload.github.com`), the only host the
 * builder fetches from, so a URL can't point the server anywhere else (SSRF). Private
 * repositories need a GitHub connection (Story 12.5) and are reported as not found.
 */
import { readZip } from '@greenfield/bridge/file';
import { ValidationError } from '../types';
import type { SourceFile } from './tokens';

/** Compressed tarball limit. */
export const MAX_REPO_BYTES = 40 * 1024 * 1024;
/** Text kept from one file, and from all of them. */
const MAX_FILE_CHARS = 200_000;
const MAX_TOTAL_CHARS = 8_000_000;

const SKIP_DIR =
  /(^|\/)(node_modules|\.git|\.next|dist|build|out|coverage|vendor|\.turbo|\.vercel|storybook-static)\//;
/** Files that can hold tokens or components. */
const KEEP =
  /(\.(css|scss|pcss)|(^|\/)tailwind\.config\.(js|cjs|mjs|ts|cts|mts)|(^|\/)package\.json|(^|\/)(tokens?|theme)[\w.-]*\.json|(^|\/)(layout|_app|fonts?)\.(tsx|jsx|ts|js)|(^|\/)(components?|ui)\/(?:[\w-]+\/)*[\w-]+\.(tsx|jsx))$/i;

export const keepSourcePath = (path: string) => !SKIP_DIR.test(`/${path}`) && KEEP.test(path);

export interface GithubRepo {
  owner: string;
  repo: string;
  ref: string | null;
}

/** `https://github.com/owner/repo[/tree/ref]`, `github.com/owner/repo` or `owner/repo`. */
export function parseGithubUrl(raw: string): GithubRepo {
  const v = raw.trim().replace(/\.git$/, '');
  const m =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/tree\/([\w./-]+))?\/?$/i.exec(
      v,
    ) ?? /^([\w.-]+)\/([\w.-]+)$/.exec(v);
  if (!m || m[1]!.startsWith('.') || m[2]!.startsWith('.'))
    throw new ValidationError('Enter a GitHub repository URL, like https://github.com/owner/repo.');
  return { owner: m[1]!, repo: m[2]!, ref: m[3] ?? null };
}

const decoder = new TextDecoder();

/** Files of a (decompressed) tar archive, with the archive's top folder stripped. */
export function readTar(tar: Uint8Array, keep: (path: string) => boolean): SourceFile[] {
  const out: SourceFile[] = [];
  let total = 0;
  let longName: string | null = null;
  const str = (o: number, n: number) => {
    const end = tar.indexOf(0, o);
    return decoder.decode(tar.subarray(o, end < 0 || end > o + n ? o + n : end));
  };
  for (let o = 0; o + 512 <= tar.length;) {
    if (tar[o] === 0) break;
    const size = parseInt(str(o + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(tar[o + 156] || 48);
    const prefix = str(o + 345, 155);
    const name = longName ?? (prefix ? `${prefix}/${str(o, 100)}` : str(o, 100));
    longName = null;
    const body = tar.subarray(o + 512, o + 512 + size);
    o += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      const path = /\d+ path=([^\n]*)\n/.exec(decoder.decode(body));
      if (path) longName = path[1]!;
      continue;
    }
    if (type === 'L') {
      longName = decoder.decode(body).replace(/\0+$/, '');
      continue;
    }
    if (type !== '0' && type !== '\0') continue;
    const path = name.split('/').slice(1).join('/');
    if (!path || !keep(path) || total > MAX_TOTAL_CHARS) continue;
    const text = decoder.decode(body).slice(0, MAX_FILE_CHARS);
    total += text.length;
    out.push({ path, text });
  }
  return out;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The repository's relevant files, from its tarball. */
export async function readGithubRepo(
  repo: GithubRepo,
  fetchImpl: typeof fetch = fetch,
): Promise<SourceFile[]> {
  const url = `https://codeload.github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/tar.gz/${repo.ref ? repo.ref.split('/').map(encodeURIComponent).join('/') : 'HEAD'}`;
  const res = await fetchImpl(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  if (!res) throw new ValidationError('Could not reach GitHub. Try again in a moment.');
  if (res.status === 404)
    throw new ValidationError(
      `${repo.owner}/${repo.repo} wasn't found. Private repositories need a GitHub connection; upload the code instead.`,
    );
  if (!res.ok) throw new ValidationError(`GitHub answered ${res.status}. Try again in a moment.`);
  const declared = Number(res.headers.get('content-length') ?? NaN);
  if (declared > MAX_REPO_BYTES) throw new ValidationError('That repository is too large to read.');
  const reader = res.body?.getReader();
  if (!reader) throw new ValidationError('GitHub sent an empty archive.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REPO_BYTES) {
      await reader.cancel();
      throw new ValidationError('That repository is too large to read.');
    }
    chunks.push(value);
  }
  const gz = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    gz.set(c, at);
    at += c.byteLength;
  }
  try {
    return readTar(await gunzip(gz), keepSourcePath);
  } catch {
    throw new ValidationError('GitHub sent an archive that could not be read.');
  }
}

export interface Upload {
  name: string;
  bytes: Uint8Array;
}

export interface ReadUploads {
  files: SourceFile[];
  /** SVG colours (a logo, icons), as a "Brand" source. */
  svgColours: string[];
  /** Uploads the builder can't read yet (images, PDFs, decks, .fig). */
  unread: string[];
}

/** Uploaded files: code, a `.zip` of code, and SVGs. Others are listed as unread. */
export async function readUploads(uploads: Upload[]): Promise<ReadUploads> {
  const files: SourceFile[] = [];
  const svgColours: string[] = [];
  const unread: string[] = [];
  for (const u of uploads) {
    const lower = u.name.toLowerCase();
    if (lower.endsWith('.zip')) {
      const zip = await readZip(u.bytes);
      if (!zip) {
        unread.push(u.name);
        continue;
      }
      // A zip of a repository usually has one top folder; keep paths relative to the code.
      for (const [path, bytes] of zip) {
        const p = path.replace(/^[^/]+\/(?=.*\/)/, '');
        if (keepSourcePath(p) || keepSourcePath(path))
          files.push({ path: p, text: decoder.decode(bytes).slice(0, MAX_FILE_CHARS) });
      }
    } else if (lower.endsWith('.svg')) {
      const text = decoder.decode(u.bytes);
      for (const m of text.matchAll(
        /(?:fill|stroke|stop-color)\s*[=:]\s*["']?(#[0-9a-f]{3,8})\b/gi,
      ))
        svgColours.push(m[1]!.toLowerCase());
    } else if (keepSourcePath(u.name) || /\.(css|scss|js|cjs|mjs|ts|tsx|jsx|json)$/i.test(lower))
      files.push({
        // A loose component file is read as one: `button.tsx` → `components/button.tsx`.
        path:
          /\.(tsx|jsx)$/i.test(lower) && !keepSourcePath(u.name) ? `components/${u.name}` : u.name,
        text: decoder.decode(u.bytes).slice(0, MAX_FILE_CHARS),
      });
    else unread.push(u.name);
  }
  return { files, svgColours: [...new Set(svgColours)], unread };
}
