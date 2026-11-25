/**
 * The in-sandbox program (Story 4.5) run from its exact source text: with fakes for every
 * dependency, and (when FIGCRAFT_CLI points at a built `figcraft-cli`) against the real headless
 * editor, which also proves its confinement to the job folder (Story 4.6).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ENTRYPOINT_SOURCE, JOB_INPUT_PATH, JOB_SPEC_PATH, JOB_WORK_DIR } from './index';

type Result = { content: { type: string; text?: string; data?: string }[]; isError?: boolean };
type Cli = {
  call(name: string, args: Record<string, unknown>): Promise<Result>;
  close(): Promise<void>;
};
interface Entry {
  main(deps: unknown): Promise<number>;
  runTool(cli: Cli, name: string, input: unknown): Promise<Result>;
  realDeps(): Promise<
    Record<string, unknown> & { connectCli(c: string, a: string[]): Promise<Cli> }
  >;
}

/** Load the exact source, from inside this package so its SDK imports resolve. */
async function load(): Promise<Entry> {
  const dir = join(import.meta.dirname, '../node_modules/.greenfield-entry');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `entry-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, ENTRYPOINT_SOURCE);
  return (await import(pathToFileURL(file).href)) as Entry;
}

const env = {
  GREENFIELD_API_URL: 'https://app.example.com',
  ANTHROPIC_AUTH_TOKEN: 'cjt_tok',
  ANTHROPIC_MODEL: 'claude-opus-5-5',
};
const cliBytes = new TextEncoder().encode('#!/bin/sh\necho fake cli\n');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const spec = {
  jobId: 'j1',
  kind: 'generate',
  prompt: 'Design a pricing page',
  systemPrompt: 'S',
  tools: [
    { name: 'run_batch', description: 'Change', input_schema: { type: 'object' } },
    { name: 'get_outline', description: 'Outline', input_schema: { type: 'object' } },
  ],
  maxTurns: 5,
  cli: { url: 'https://github.com/o/r/releases/download/v1/figcraft-cli', sha256: sha(cliBytes) },
  newDocument: false,
};
const textResult = (v: unknown): Result => ({
  content: [{ type: 'text', text: JSON.stringify(v) }],
});

/** A fake headless editor: one page, with a frame added by the first batch. */
function fakeCli() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let frames = [{ id: 2, name: 'Hero' }];
  const cli: Cli = {
    async call(name, args) {
      calls.push({ name, args });
      if (name === 'inspect_document')
        return textResult({ currentPage: 1, selection: [], pages: [{ id: 1, children: frames }] });
      if (name === 'batch') {
        frames = [...frames, { id: 9, name: 'Pricing' }];
        return textResult([{ id: 9 }]);
      }
      return textResult({ ok: true });
    },
    close: vi.fn(async () => {}),
  };
  return { cli, calls };
}

function fakeDeps(over: Record<string, unknown> = {}) {
  const reports: { type: string; data: Record<string, unknown> }[] = [];
  const uploads: Uint8Array[] = [];
  const written = new Map<string, Uint8Array>();
  const { cli, calls } = fakeCli();
  let connected: { command: string; args: string[] } | null = null;
  let options: Record<string, unknown> = {};
  let handler: ((name: string, input: unknown) => Promise<Result>) | null = null;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === spec.cli.url) return new Response(cliBytes);
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer cjt_tok');
    if (url.endsWith('/file')) {
      uploads.push(init!.body as Uint8Array);
      return Response.json({ versionId: 'v1' });
    }
    reports.push(JSON.parse(String(init!.body)));
    return new Response('{}');
  });
  const deps = {
    env,
    fetch,
    readFile: async (p: string) =>
      p === JOB_SPEC_PATH ? JSON.stringify(spec) : new TextEncoder().encode('SAVED'),
    writeFile: async (p: string, b: Uint8Array) => void written.set(p, b),
    mkdir: async () => {},
    chmod: async () => {},
    exec: async () => '',
    sha256: sha,
    cliPath: null,
    connectCli: async (command: string, args: string[]) => {
      connected = { command, args };
      return cli;
    },
    toolServer: async (_tools: unknown, h: typeof handler) => {
      handler = h;
      return { type: 'sdk', name: 'greenfield', instance: {} };
    },
    query: ({ options: o }: { options: Record<string, unknown> }) => {
      options = o;
      return (async function* () {
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Building' }] } };
        yield {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'mcp__greenfield__run_batch' }] },
        };
        await handler!('run_batch', { label: 'Pricing', commands: [{ command: 'node.create' }] });
        yield { type: 'result', subtype: 'success', result: 'Added a pricing frame.' };
      })();
    },
    ...over,
  };
  return {
    deps,
    reports,
    uploads,
    written,
    calls,
    cli,
    connected: () => connected,
    options: () => options,
  };
}

describe('sandbox entrypoint (Story 4.5)', () => {
  it('installs the pinned CLI, edits the copy, uploads it and reports the new frames', async () => {
    const { main } = await load();
    const f = fakeDeps();
    expect(await main(f.deps)).toBe(0);

    // The CLI came from the pinned URL, checked by sha256, and runs confined to the job folder.
    expect(f.written.get('/vercel/sandbox/bin/figcraft-cli')).toEqual(cliBytes);
    expect(f.connected()).toEqual({
      command: '/vercel/sandbox/bin/figcraft-cli',
      args: [
        'mcp',
        '--automation-read-root',
        JOB_WORK_DIR,
        '--automation-write-root',
        JOB_WORK_DIR,
      ],
    });
    expect(f.calls[0]).toEqual({ name: 'open_file', args: { path: JOB_INPUT_PATH } });
    expect(f.calls).toContainEqual({
      name: 'batch',
      args: { label: 'Pricing', commands: [{ command: 'node.create' }] },
    });
    expect(f.calls.find((c) => c.name === 'save_file')!.args.path).toMatch(
      new RegExp(`^${JOB_WORK_DIR}/`),
    );

    // Only the contract's tools, served in-process; no built-in tools.
    expect(f.options()).toMatchObject({
      tools: [],
      allowedTools: ['mcp__greenfield__run_batch', 'mcp__greenfield__get_outline'],
      permissionMode: 'dontAsk',
      settingSources: [],
      model: 'claude-opus-5-5',
    });
    expect(f.uploads).toEqual([new TextEncoder().encode('SAVED')]);
    expect(f.reports.map((r) => r.type)).toEqual([
      'progress',
      'progress',
      'log',
      'tool',
      'progress',
      'progress',
      'result',
    ]);
    expect(f.reports.at(-1)!.data).toEqual({
      summary: 'Added a pricing frame.',
      versionId: 'v1',
      frames: [{ id: 9, name: 'Pricing' }],
    });
    expect(f.cli.close).toHaveBeenCalled();
  });

  it('refuses a CLI whose sha256 does not match the pin', async () => {
    const { main } = await load();
    const f = fakeDeps({
      fetch: vi.fn(async (url: string, init?: RequestInit) => {
        if (url === spec.cli.url) return new Response('tampered');
        f.reports.push(JSON.parse(String(init!.body)));
        return new Response('{}');
      }),
    });
    expect(await main(f.deps)).toBe(1);
    expect(f.connected()).toBeNull();
    expect(f.reports.at(-1)).toEqual({ type: 'error', data: { message: 'cli_sha256_mismatch' } });
  });

  it('stops without reporting when the job token is revoked', async () => {
    const { main } = await load();
    const f = fakeDeps({
      fetch: vi.fn(async (url: string) =>
        url === spec.cli.url ? new Response(cliBytes) : new Response('{}', { status: 401 }),
      ),
    });
    expect(await main(f.deps)).toBe(1);
  });

  it('maps the contract tools onto the CLI and refuses the rest', async () => {
    const { runTool } = await load();
    const { cli, calls } = fakeCli();
    await runTool(cli, 'get_outline', { depth: 2 });
    await runTool(cli, 'get_outline', { root: 2, depth: 1 });
    await runTool(cli, 'render', { ids: [2], scale: 0.5 });
    await runTool(cli, 'list_commands', { query: 'node' });
    expect(calls).toEqual([
      { name: 'inspect_document', args: { depth: 2, outline: true } },
      { name: 'get_node', args: { id: 2, depth: 1, outline: true } },
      { name: 'screenshot', args: { ids: [2], scale: 0.5, maxSize: 1600 } },
      { name: 'list_commands', args: { filter: 'node' } },
    ]);
    expect((await runTool(cli, 'comment_thread', {})).isError).toBe(true);
  });
});

const CLI = process.env.FIGCRAFT_CLI;

describe.skipIf(!CLI || !existsSync(CLI))('against a real figcraft-cli (Story 4.6)', () => {
  /** A job folder with a document in it, and a secret file next to it. */
  function folders() {
    const root = mkdtempSync(join(tmpdir(), 'greenfield-job-'));
    const work = join(root, 'work');
    mkdirSync(work);
    writeFileSync(join(root, 'secret.txt'), 'ANTHROPIC_API_KEY=sk-ant-not-here');
    return { root, work };
  }

  it('edits, renders and saves inside the job folder', async () => {
    const { runTool, realDeps } = await load();
    const { work } = folders();
    const deps = await realDeps();
    const cli = await deps.connectCli(CLI!, [
      'mcp',
      '--automation-read-root',
      work,
      '--automation-write-root',
      work,
    ]);
    try {
      const made = await runTool(cli, 'run_batch', {
        label: 'Pricing',
        commands: [
          {
            command: 'node.create',
            as: 'f',
            params: {
              type: 'frame',
              name: 'Pricing',
              width: 400,
              height: 300,
              props: { fill: '#f5f1e8' },
            },
          },
          {
            command: 'node.create',
            params: { type: 'text', parent: { $ref: 'f' }, text: 'Plans' },
          },
        ],
      });
      expect(made.isError).toBeFalsy();
      const outline = await runTool(cli, 'get_outline', { depth: 2 });
      expect(outline.content[0]!.text).toContain('Pricing');
      const shot = await runTool(cli, 'render', { scale: 0.5 });
      expect(shot.isError).toBeFalsy();
      expect(shot.content.some((c) => c.type === 'image')).toBe(true);
      const saved = await cli.call('save_file', { path: join(work, 'result.figcraft') });
      expect(saved.isError).toBeFalsy();
      expect(readFileSync(join(work, 'result.figcraft')).length).toBeGreaterThan(0);
    } finally {
      await cli.close();
    }
  }, 60_000);

  it('cannot read or write outside the job folder', async () => {
    const { realDeps } = await load();
    const { root, work } = folders();
    const deps = await realDeps();
    const cli = await deps.connectCli(CLI!, [
      'mcp',
      '--automation-read-root',
      work,
      '--automation-write-root',
      work,
    ]);
    try {
      const read = await cli.call('open_file', { path: join(root, 'secret.txt') });
      expect(read.isError).toBe(true);
      const escape = await cli.call('open_file', { path: join(work, '..', 'secret.txt') });
      expect(escape.isError).toBe(true);
      const write = await cli.call('save_file', { path: join(root, 'stolen.figcraft') });
      expect(write.isError).toBe(true);
      expect(existsSync(join(root, 'stolen.figcraft'))).toBe(false);
      const exported = await cli.call('export', { format: 'png', path: join(root, 'out.png') });
      expect(exported.isError).toBe(true);
      expect(existsSync(join(root, 'out.png'))).toBe(false);
      // Inside the folder works.
      const ok = await cli.call('save_file', { path: join(work, 'ok.figcraft') });
      expect(ok.isError).toBeFalsy();
    } finally {
      await cli.close();
    }
  }, 60_000);
});
