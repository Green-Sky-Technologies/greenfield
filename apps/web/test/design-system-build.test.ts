/**
 * Stories 10.2 and 10.6: build a design system from a repository or uploads, then update the
 * files that use it when a new version is published. Real Postgres; GitHub is a fake `fetch`
 * that serves a tarball of `fixtures/tailwind-repo` (a typical shadcn-style Tailwind v3 site).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError } from '@greenfield/authz';
import { editLocks } from '@greenfield/db';
import { loadDesignFile, localFsStorage } from '@/server/services/design-files';
import {
  buildDesignSystem,
  createProjectWithDefaultSystem,
  designSystemChanges,
  designSystemFiles,
  publishDesignSystem,
  rebuildDesignSystem,
  setDefaultDesignSystem,
  updateDesignSystemFiles,
  type BuildStep,
} from '@/server/services/design-systems';
import {
  readLibraryFile,
  type FigcraftDocument,
} from '@/server/services/design-systems/library-file';
import { parseGithubUrl, readTar } from '@/server/services/design-systems/sources';
import {
  extractTokens,
  parseColour,
  type SourceFile,
} from '@/server/services/design-systems/tokens';
import { ValidationError } from '@/server/services/types';
import { makeActor, reset, testDb } from './helpers';

const REPO = path.join(import.meta.dirname, 'fixtures/tailwind-repo');
const repoFiles = (): SourceFile[] =>
  (fs.readdirSync(REPO, { recursive: true }) as string[])
    .filter((p) => fs.statSync(path.join(REPO, p)).isFile())
    .map((p) => ({
      path: p.split(path.sep).join('/'),
      text: fs.readFileSync(path.join(REPO, p), 'utf8'),
    }));

/** A ustar archive of `files` under a top folder, gzipped, as GitHub's tarball endpoint sends. */
async function tarball(files: SourceFile[], top = 'voirdire-site-main'): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const blocks: Uint8Array[] = [];
  const header = (name: string, size: number) => {
    const h = new Uint8Array(512);
    h.set(enc.encode(name.slice(0, 100)), 0);
    h.set(enc.encode('0000644\0'), 100);
    h.set(enc.encode(`${size.toString(8).padStart(11, '0')}\0`), 124);
    h[156] = 48;
    h.set(enc.encode('ustar\0'), 257);
    h.set(enc.encode('        '), 148);
    const sum = h.reduce((a, b) => a + b, 0);
    h.set(enc.encode(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
    return h;
  };
  for (const f of files) {
    const body = enc.encode(f.text);
    blocks.push(
      header(`${top}/${f.path}`, body.length),
      body,
      new Uint8Array((512 - (body.length % 512)) % 512),
    );
  }
  blocks.push(new Uint8Array(1024));
  const tar = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of blocks) {
    tar.set(b, at);
    at += b.length;
  }
  const gz = new Blob([tar]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(gz).arrayBuffer());
}

function fakeGithub(files: () => SourceFile[]) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    if (!url.startsWith('https://codeload.github.com/green-sky/voirdire/'))
      return new Response('Not Found', { status: 404 });
    return new Response((await tarball(files())) as BodyInit, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

const { db, close } = testDb();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-build-'));
const storage = localFsStorage(dir);
afterAll(async () => {
  await close();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => reset(db));

const variable = (doc: FigcraftDocument, name: string) =>
  (doc.variables?.variables ?? []).find((v) => v.name === name) as
    { id: string; values: Record<string, { value: unknown }> } | undefined;
const colourOf = (v: { values: Record<string, { value: unknown }> } | undefined) => {
  const c = Object.values(v?.values ?? {})[0]?.value as { r: number; g: number; b: number };
  const h = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0');
  return c && `#${h(c.r)}${h(c.g)}${h(c.b)}`;
};

describe('reading tokens (10.2)', () => {
  it('reads a shadcn-style Tailwind v3 repository', () => {
    const t = extractTokens(repoFiles());
    expect(t.tailwind).toBe(true);
    const byName = new Map(t.colours.map((c) => [c.name, c]));
    expect(byName.get('primary')).toMatchObject({
      group: 'Theme',
      hex: parseColour('hsl(8 73% 53%)'),
    });
    expect(byName.get('primary')!.dark).toBe(parseColour('hsl(8 80% 60%)'));
    expect(byName.get('primary-foreground')?.group).toBe('Theme');
    expect(byName.get('rubric/500')).toMatchObject({ group: 'Rubric', hex: '#df4630' });
    expect(byName.get('ink/900')).toMatchObject({ group: 'Ink', hex: '#14140f' });
    // No spacing or type in the config: Tailwind's defaults are what the site uses.
    expect(t.spacing.slice(0, 4)).toEqual([
      { name: 'space/1', value: 4 },
      { name: 'space/2', value: 8 },
      { name: 'space/3', value: 12 },
      { name: 'space/4', value: 16 },
    ]);
    expect(t.type.map((x) => x.step)).toContain('base');
    expect(t.radius).toEqual([
      { name: 'radius/lg', value: 8 },
      { name: 'radius/md', value: 6 },
      { name: 'radius/sm', value: 4 },
    ]);
    expect(t.fonts).toEqual({ sans: 'Inter', heading: 'Cormorant Garamond', mono: null });
    expect(t.components.map((c) => c.name).sort()).toEqual([
      'Badge',
      'Button',
      'Card',
      'Input',
      'Navbar',
    ]);
    expect(t.components.find((c) => c.name === 'Button')!.classes).toContain('rounded-md');
  });

  it('reads Tailwind v4 @theme tokens through var() and light-dark()', () => {
    const t = extractTokens([
      {
        path: 'app/globals.css',
        text: `@import 'tailwindcss';
          :root { --ground: light-dark(#f3f0e8, #0b0c0a); --field: light-dark(#1b733f, #3fd67f); }
          :root { --bg: var(--ground); --accent: var(--field); }
          @theme inline {
            --color-bg: var(--bg);
            --color-accent: var(--accent);
            --color-brand-500: oklch(0.63 0.2 30);
            --font-sans: var(--font-plex-sans);
            --text-hero: 3.5rem;
            --radius-card: 12px;
          }`,
      },
      {
        path: 'app/layout.tsx',
        text: `import { IBM_Plex_Sans } from 'next/font/google';
          const plex = IBM_Plex_Sans({ variable: '--font-plex-sans', weight: ['400'] });`,
      },
    ]);
    expect(t.colours.map((c) => [c.name, c.group, c.hex, c.dark])).toEqual([
      ['bg', 'Theme', '#f3f0e8', '#0b0c0a'],
      ['accent', 'Theme', '#1b733f', '#3fd67f'],
      ['brand/500', 'Brand', expect.stringMatching(/^#[0-9a-f]{6}$/), undefined],
    ]);
    expect(t.fonts.sans).toBe('IBM Plex Sans');
    expect(t.type).toEqual([{ step: 'hero', size: 56, lineHeight: null }]);
    expect(t.radius).toEqual([{ name: 'radius/card', value: 12 }]);
    expect(t.spacing[0]).toEqual({ name: 'space/1', value: 4 });
  });

  it('accepts only GitHub repository URLs', () => {
    expect(parseGithubUrl('https://github.com/green-sky/voirdire')).toEqual({
      owner: 'green-sky',
      repo: 'voirdire',
      ref: null,
    });
    expect(parseGithubUrl('github.com/green-sky/voirdire/tree/release/v2').ref).toBe('release/v2');
    expect(parseGithubUrl('green-sky/voirdire.git').repo).toBe('voirdire');
    for (const bad of [
      'https://evil.example/green-sky/voirdire',
      'http://169.254.169.254/x/y',
      '../x',
    ])
      expect(() => parseGithubUrl(bad)).toThrow(ValidationError);
  });

  it('reads tar archives with long (pax) paths', async () => {
    const enc = new TextEncoder();
    const long = `${'a/'.repeat(60)}components/button.tsx`;
    const h = (name: string, size: number, type: string) => {
      const b = new Uint8Array(512);
      b.set(enc.encode(name.slice(0, 100)), 0);
      b.set(enc.encode(`${size.toString(8).padStart(11, '0')}\0`), 124);
      b[156] = type.charCodeAt(0);
      return b;
    };
    const pax = enc.encode(`${long.length + 15} path=top/${long}\n`);
    const body = enc.encode('export const Button = 1;');
    const parts = [
      h('top/PaxHeader', pax.length, 'x'),
      pax,
      new Uint8Array(512 - pax.length),
      h('top/short-name', body.length, '0'),
      body,
      new Uint8Array(512 - body.length),
      new Uint8Array(1024),
    ];
    const tar = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      tar.set(p, at);
      at += p.length;
    }
    expect(readTar(tar, () => true)).toEqual([{ path: long, text: 'export const Button = 1;' }]);
  });
});

describe('building a system (10.2)', () => {
  it('builds colour, type and spacing variables and the core components from a Tailwind repo', async () => {
    const admin = await makeActor(db, 'admin');
    const gh = fakeGithub(repoFiles);
    const steps: BuildStep[] = [];
    const { system, version } = await buildDesignSystem(
      db,
      admin,
      storage,
      { name: 'Voirdire', repo: 'https://github.com/green-sky/voirdire' },
      { fetch: gh.fetchImpl, onStep: (s) => void steps.push(s) },
    );
    expect(gh.urls).toEqual(['https://codeload.github.com/green-sky/voirdire/tar.gz/HEAD']);
    expect(system.sources).toEqual([
      { kind: 'github', owner: 'green-sky', repo: 'voirdire', ref: null },
    ]);
    expect(steps.map((s) => s.step)).toEqual([
      'sources',
      'colours',
      'type',
      'scales',
      'components',
      'guide',
    ]);
    expect(steps[0]!.text).toBe(
      'Read github.com/green-sky/voirdire: Tailwind config, CSS variables, 5 React components',
    );

    // The review offers the colour groups, the scales, the type styles and the core components.
    const kinds = (k: string) => version.items.filter((i) => i.kind === k).map((i) => i.name);
    expect(kinds('colours')).toEqual(['Theme', 'Rubric', 'Ink']);
    expect(kinds('spacing')).toEqual(['Spacing', 'Radius']);
    expect(kinds('type')).toEqual(expect.arrayContaining(['body/base', 'body/sm', 'heading/2xl']));
    expect(kinds('component')).toEqual(['Button', 'Input', 'Card', 'Nav']);
    expect(version.guide).toContain('# Voirdire');
    expect(version.guide).toContain('- Primary: `primary`');
    expect(version.guide).toContain('Body: Inter Regular');
    expect(version.guide).toContain('The codebase also has: Badge. Match');

    // The library file: components bound to the variables, text on the text styles.
    const file = await storage.read(version.sourceKey);
    const { doc } = await readLibraryFile(
      new Uint8Array(await new Response(file!.body).arrayBuffer()),
    );
    const button = Object.values(doc.nodes).find(
      (n) => n.name === 'Button' && n.type === 'component',
    )!;
    expect(button.bound).toEqual({
      fill: variable(doc, 'primary')!.id,
      cornerRadius: variable(doc, 'radius/md')!.id,
      gap: variable(doc, 'space/2')!.id,
      paddingHorizontal: variable(doc, 'space/4')!.id,
      paddingVertical: variable(doc, 'space/2')!.id,
    });
    const label = doc.nodes[String((button.children as number[])[0])]!;
    expect(label).toMatchObject({
      type: 'text',
      characters: 'Button',
      bound: { fill: variable(doc, 'primary-foreground')!.id },
    });
    expect((label.styles as { text: string }).text).toMatch(/^S:/);
    // Theme colours have a Dark mode.
    const theme = (doc.variables!.collections as { name: string; modes: { name: string }[] }[])[0]!;
    expect(theme).toMatchObject({ name: 'Theme', modes: [{ name: 'Light' }, { name: 'Dark' }] });
  });

  it('builds from uploaded files, says what it could not read, and needs edit rights', async () => {
    const admin = await makeActor(db, 'admin');
    const viewer = await makeActor(db, 'viewer', admin.workspace);
    const uploads = repoFiles()
      .filter((f) => /globals\.css|tailwind\.config|button\.tsx/.test(f.path))
      .map((f) => ({ name: path.basename(f.path), bytes: new TextEncoder().encode(f.text) }));
    uploads.push({
      name: 'logo.svg',
      bytes: new TextEncoder().encode('<svg><path fill="#DF4630"/></svg>'),
    });
    uploads.push({ name: 'deck.pdf', bytes: new Uint8Array([37, 80, 68, 70]) });
    const steps: BuildStep[] = [];
    const { system, version } = await buildDesignSystem(
      db,
      admin,
      storage,
      { name: 'From uploads', uploads },
      { onStep: (s) => void steps.push(s) },
    );
    expect(steps[0]!.text).toContain('Not read yet: deck.pdf');
    expect(version.items.filter((i) => i.kind === 'colours').map((i) => i.name)).toContain('Logo');
    expect(system.sources).toEqual([{ kind: 'upload', names: uploads.map((u) => u.name) }]);

    await expect(
      buildDesignSystem(db, viewer, storage, { name: 'No', uploads }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      buildDesignSystem(db, admin, storage, {
        name: 'Empty',
        uploads: [{ name: 'x.pdf', bytes: new Uint8Array(1) }],
      }),
    ).rejects.toThrow(/No colours, type or components/);
    await expect(
      buildDesignSystem(
        db,
        admin,
        storage,
        { name: 'Private', repo: 'github.com/someone/private' },
        { fetch: fakeGithub(repoFiles).fetchImpl },
      ),
    ).rejects.toThrow(/wasn't found/);
  });
});

describe('updates (10.6)', () => {
  it('a new version is reviewed, published, and updates the files that use it', async () => {
    const admin = await makeActor(db, 'admin');
    const editor = await makeActor(db, 'editor', admin.workspace);
    let files = repoFiles();
    const gh = fakeGithub(() => files);
    const { system } = await buildDesignSystem(
      db,
      admin,
      storage,
      { name: 'Voirdire', repo: 'github.com/green-sky/voirdire' },
      { fetch: gh.fetchImpl },
    );
    await publishDesignSystem(db, admin, storage, { systemId: system.id });
    await setDefaultDesignSystem(db, admin, { systemId: system.id });
    const landing = await createProjectWithDefaultSystem(db, editor, storage, { name: 'Landing' });
    const open = await createProjectWithDefaultSystem(db, editor, storage, { name: 'Open file' });

    // The repo changes: the primary colour, the brand red, and a new colour.
    files = files.map((f) =>
      f.path === 'app/globals.css'
        ? { ...f, text: f.text.replace('--primary: 8 73% 53%;', '--primary: 150 60% 35%;') }
        : f.path === 'tailwind.config.ts'
          ? { ...f, text: f.text.replace("500: '#df4630'", "500: '#e1472f', 700: '#9a2e1e'") }
          : f,
    );
    const v2 = await rebuildDesignSystem(
      db,
      editor,
      storage,
      { systemId: system.id },
      { fetch: gh.fetchImpl },
    );
    expect(v2.version).toBe(2);
    const review = await designSystemChanges(db, editor, { systemId: system.id });
    expect(review.from).toEqual({ version: 1 });
    expect(review.changes).toEqual(
      expect.arrayContaining([
        {
          kind: 'colour',
          change: 'changed',
          name: 'primary',
          from: expect.any(String),
          to: '#248f59',
        },
        { kind: 'colour', change: 'changed', name: 'rubric/500', from: '#df4630', to: '#e1472f' },
        { kind: 'colour', change: 'added', name: 'rubric/700' },
      ]),
    );
    expect(review.changes).toHaveLength(3);

    // Publishing v2 doesn't touch files; updating them does (editors can't).
    await publishDesignSystem(db, admin, storage, { systemId: system.id });
    expect(
      (await designSystemFiles(db, editor, { systemId: system.id })).map((f) => [
        f.projectName,
        f.version,
      ]),
    ).toEqual([
      ['Landing', 1],
      ['Open file', 1],
    ]);
    await expect(
      updateDesignSystemFiles(db, editor, storage, { systemId: system.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await db.insert(editLocks).values({
      projectId: open.id,
      workspaceId: admin.workspace.id,
      holderUserId: editor.userId,
      sessionId: 'tab-1',
    });
    const before = await loadDesignFile(db, editor, storage, { projectId: landing.id });
    const result = await updateDesignSystemFiles(db, admin, storage, { systemId: system.id });
    expect(result).toEqual({
      updated: ['Landing'],
      skipped: [{ projectName: 'Open file', reason: 'open in the editor' }],
    });
    expect(
      (await designSystemFiles(db, editor, { systemId: system.id })).map((f) => f.version),
    ).toEqual([2, 1]);

    // The file has the new values, the new colour, and its Button shows the new primary.
    const after = await loadDesignFile(db, editor, storage, { projectId: landing.id });
    const { doc } = await readLibraryFile(after!.bytes);
    const { doc: old } = await readLibraryFile(before!.bytes);
    expect(colourOf(variable(old, 'primary'))).not.toBe('#248f59');
    expect(colourOf(variable(doc, 'primary'))).toBe('#248f59');
    expect(variable(doc, 'primary')!.id).toBe(variable(old, 'primary')!.id);
    expect(colourOf(variable(doc, 'rubric/700'))).toBe('#9a2e1e');
    const button = Object.values(doc.nodes).find(
      (n) => n.name === 'Button' && n.type === 'component',
    )!;
    const oldButton = Object.values(old.nodes).find(
      (n) => n.name === 'Button' && n.type === 'component',
    )!;
    expect(button.id).toBe(oldButton.id);
    expect(button.bound).toMatchObject({ fill: variable(doc, 'primary')!.id });
    const fill = (button.fills as { color: { r: number; g: number; b: number } }[])[0]!.color;
    expect(colourOf({ values: { m: { value: fill } } })).toBe('#248f59');
    // The file's own first page is untouched.
    expect(doc.nodes[String(doc.pages[0])]).toEqual(old.nodes[String(old.pages[0])]);

    // Once the file is closed it updates too.
    await db.delete(editLocks);
    expect(await updateDesignSystemFiles(db, admin, storage, { systemId: system.id })).toEqual({
      updated: ['Open file'],
      skipped: [],
    });
  });
});
