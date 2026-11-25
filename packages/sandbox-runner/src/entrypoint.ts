/**
 * The program that runs inside a job sandbox (Story 4.5). It is shipped as source text (written
 * to the VM with writeFiles) so it doesn't depend on the app's bundle. It:
 *  - installs the headless editor (`figcraft-cli`, Linux x86_64, from the fork's release) and
 *    checks its sha256 against the pin in the job spec;
 *  - starts `figcraft-cli mcp` confined to the job folder (`--automation-read-root` and
 *    `--automation-write-root`, Story 4.6) and opens the copy of the file there;
 *  - runs the Claude Agent SDK with no built-in tools, only the agent tool contract (Story 1.4:
 *    run_batch, get_node, get_outline, render, …), each mapped onto the CLI's MCP tools in this
 *    process;
 *  - streams progress to POST /api/jobs/:id/report, saves the result, uploads it
 *    (PUT /api/jobs/:id/file, which stores an `agent` version), then reports the result.
 * The SDK's model calls go to ANTHROPIC_BASE_URL (our LLM proxy) with the job token: no
 * provider key is ever in the VM (Story 4.6). The CLI gets a minimal environment (no token).
 *
 * `main(deps)` takes its dependencies so tests run this exact source with fakes, or with a
 * real local `figcraft-cli`.
 */

export const SANDBOX_DIR = '/vercel/sandbox';
export const ENTRYPOINT_PATH = `${SANDBOX_DIR}/greenfield-job.mjs`;
export const JOB_SPEC_PATH = `${SANDBOX_DIR}/job.json`;
/** The job's folder: the only one the editor may read or write. */
export const JOB_WORK_DIR = `${SANDBOX_DIR}/work`;
/** The copy of the project's file the job edits. */
export const JOB_INPUT_PATH = `${JOB_WORK_DIR}/document.figcraft`;
export const JOB_CLI_DIR = `${SANDBOX_DIR}/bin`;

/** A Linux `figcraft-cli` from the fork's release, pinned by sha256 (raw binary or .tar.gz). */
export interface CliPin {
  url: string;
  sha256: string;
}

/** The contract's tool definitions as the Messages API takes them (no zod in the VM). */
export interface JobToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** What the entrypoint reads from job.json. No secrets: the token comes from the env. */
export interface JobSpec {
  jobId: string;
  kind: string;
  prompt: string;
  systemPrompt: string;
  tools: JobToolDef[];
  maxTurns: number;
  cli: CliPin;
  /** No file yet: start from the editor's empty document instead of opening one. */
  newDocument: boolean;
}

export const AGENT_SDK_VERSION = '0.3.318';
export const MCP_SDK_VERSION = '1.32.2';

export const SANDBOX_PACKAGE_JSON = JSON.stringify(
  {
    name: 'greenfield-job',
    private: true,
    type: 'module',
    dependencies: {
      '@anthropic-ai/claude-agent-sdk': AGENT_SDK_VERSION,
      '@modelcontextprotocol/sdk': MCP_SDK_VERSION,
    },
  },
  null,
  2,
);

export const ENTRYPOINT_SOURCE = String.raw`// Greenfield job entrypoint (generated; see packages/sandbox-runner/src/entrypoint.ts)
const SPEC_PATH = ${JSON.stringify(JOB_SPEC_PATH)};
const WORK_DIR = ${JSON.stringify(JOB_WORK_DIR)};
const INPUT_PATH = ${JSON.stringify(JOB_INPUT_PATH)};
const OUTPUT_PATH = WORK_DIR + '/result.figcraft';
const CLI_DIR = ${JSON.stringify(JOB_CLI_DIR)};
const MAX_TEXT = 40000;

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (t) => ({ content: [{ type: 'text', text: JSON.stringify({ error: t }) }], isError: true });
const textOf = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const clipped = (r) =>
  r.content && r.content.some((c) => c.type === 'text' && c.text.length > MAX_TEXT)
    ? { ...r, content: r.content.map((c) => (c.type === 'text' ? { ...c, text: c.text.slice(0, MAX_TEXT) + '\n…(truncated: ask for less with fields, depth or outline)' } : c)) }
    : r;
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** The agent tool contract on top of the CLI's MCP tools. */
export async function runTool(cli, name, input) {
  const i = input || {};
  switch (name) {
    case 'run_batch':
      return clipped(await cli.call('batch', { label: i.label, commands: i.commands }));
    case 'get_node':
      return clipped(await cli.call('get_node', defined({ id: i.id, depth: i.depth, fields: i.fields, outline: i.outline })));
    case 'get_outline':
      return clipped(
        i.root !== undefined
          ? await cli.call('get_node', defined({ id: i.root, depth: i.depth, outline: true }))
          : await cli.call('inspect_document', defined({ depth: i.depth, outline: true })),
      );
    case 'get_selection': {
      const doc = JSON.parse(textOf(await cli.call('inspect_document', { depth: 0 })) || '{}');
      const selection = [];
      for (const id of doc.selection || []) {
        const r = await cli.call('get_node', defined({ id, depth: i.depth, fields: i.fields }));
        if (!r.isError) selection.push(JSON.parse(textOf(r)));
      }
      return clipped(text(JSON.stringify({ page: doc.currentPage ?? null, selection })));
    }
    case 'list_commands':
      return clipped(await cli.call('list_commands', defined({ filter: i.query })));
    case 'render':
      return cli.call('screenshot', defined({ ids: i.ids, scale: i.scale ?? 1, maxSize: 1600 }));
    default:
      return fail(name + ' is not available in a background job.');
  }
}

/** Top-level layers of the current page: [{ id, name }]. */
async function topLevel(cli) {
  const r = await cli.call('inspect_document', { depth: 1, outline: true });
  if (r.isError) return [];
  const doc = JSON.parse(textOf(r) || '{}');
  const page = (doc.pages || []).find((p) => p.id === doc.currentPage) || (doc.pages || [])[0];
  return ((page && page.children) || []).map((c) => ({ id: c.id, name: String(c.name ?? '') }));
}

async function installCli(deps, pin) {
  if (deps.cliPath) return deps.cliPath;
  const res = await deps.fetch(pin.url, { redirect: 'follow' });
  if (!res.ok) throw new Error('cli_download_' + res.status);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (deps.sha256(bytes) !== pin.sha256) throw new Error('cli_sha256_mismatch');
  await deps.mkdir(CLI_DIR);
  if (/\.(tar\.gz|tgz)$/.test(new URL(pin.url).pathname)) {
    await deps.writeFile(CLI_DIR + '/cli.tar.gz', bytes);
    await deps.exec('tar', ['-xzf', CLI_DIR + '/cli.tar.gz', '-C', CLI_DIR]);
    const found = await deps.exec('find', [CLI_DIR, '-type', 'f', '-name', 'figcraft-cli']);
    const path = found.trim().split('\n')[0];
    if (!path) throw new Error('cli_missing_in_archive');
    await deps.chmod(path, 0o755);
    return path;
  }
  await deps.writeFile(CLI_DIR + '/figcraft-cli', bytes);
  await deps.chmod(CLI_DIR + '/figcraft-cli', 0o755);
  return CLI_DIR + '/figcraft-cli';
}

export async function main(deps) {
  const { query, fetch, env } = deps;
  const spec = JSON.parse(await deps.readFile(SPEC_PATH, 'utf8'));
  const base = env.GREENFIELD_API_URL + '/api/jobs/' + encodeURIComponent(spec.jobId);
  const auth = { authorization: 'Bearer ' + env.ANTHROPIC_AUTH_TOKEN };
  let failures = 0;
  const report = async (type, data) => {
    try {
      const res = await fetch(base + '/report', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ type, data }),
      });
      if (res.status === 401 || res.status === 409) throw new Error('job_revoked');
      failures = 0;
    } catch (e) {
      if (e && e.message === 'job_revoked') throw e;
      if (++failures > 20) throw new Error('report_failed');
    }
  };

  const abort = new AbortController();
  let cli = null;
  let summary = '';
  try {
    await report('progress', { phase: 'preparing' });
    const cliPath = await installCli(deps, spec.cli);
    cli = await deps.connectCli(cliPath, ['mcp', '--automation-read-root', WORK_DIR, '--automation-write-root', WORK_DIR]);
    if (!spec.newDocument) {
      const opened = await cli.call('open_file', { path: INPUT_PATH });
      if (opened.isError) throw new Error('open_failed: ' + textOf(opened).slice(0, 200));
    }
    const before = await topLevel(cli);
    await report('progress', { phase: 'agent_started' });

    let batches = 0;
    const server = await deps.toolServer(spec.tools, async (name, input) => {
      const r = await runTool(cli, name, input);
      if (name === 'run_batch' && !r.isError) {
        batches++;
        await report('progress', { phase: 'editing', batches });
      }
      return r;
    });
    const q = query({
      prompt: spec.prompt,
      options: {
        model: env.ANTHROPIC_MODEL,
        systemPrompt: spec.systemPrompt,
        tools: [],
        mcpServers: { greenfield: server },
        allowedTools: spec.tools.map((t) => 'mcp__greenfield__' + t.name),
        permissionMode: 'dontAsk',
        settingSources: [],
        maxTurns: spec.maxTurns,
        abortController: abort,
        env: { ...env },
      },
    });
    for await (const m of q) {
      if (m.type === 'assistant') {
        for (const b of m.message.content) {
          if (b.type === 'text' && b.text.trim()) await report('log', { text: b.text.slice(0, 4000) });
          else if (b.type === 'tool_use') await report('tool', { name: String(b.name).replace(/^mcp__greenfield__/, '') });
        }
      } else if (m.type === 'result') {
        if (m.subtype === 'success') summary = m.result || '';
        else throw new Error('agent_' + m.subtype);
      }
    }

    await report('progress', { phase: 'saving' });
    const known = new Set(before.map((f) => f.id));
    const frames = (await topLevel(cli)).filter((f) => !known.has(f.id));
    const saved = await cli.call('save_file', { path: OUTPUT_PATH });
    if (saved.isError) throw new Error('save_failed: ' + textOf(saved).slice(0, 200));
    const bytes = await deps.readFile(OUTPUT_PATH);
    const up = await fetch(base + '/file', {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/octet-stream' },
      body: bytes,
    });
    if (up.status === 401 || up.status === 409) throw new Error('job_revoked');
    if (!up.ok) throw new Error('upload_failed_' + up.status);
    const { versionId } = await up.json();
    await report('result', { summary: summary.slice(0, 8000), versionId, frames });
    return 0;
  } catch (e) {
    abort.abort();
    const message = e && e.message ? String(e.message).slice(0, 500) : 'unknown error';
    if (message !== 'job_revoked') await report('error', { message }).catch(() => {});
    return 1;
  } finally {
    if (cli) await cli.close().catch(() => {});
  }
}

/** The real dependencies (inside the VM, or locally with FIGCRAFT_CLI for tests). */
export async function realDeps() {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  const fs = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const { execFile } = await import('node:child_process');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
  return {
    query: sdk.query,
    fetch: globalThis.fetch,
    env: process.env,
    readFile: (p, enc) => fs.readFile(p, enc),
    writeFile: (p, b) => fs.writeFile(p, b),
    mkdir: (p) => fs.mkdir(p, { recursive: true }),
    chmod: (p, m) => fs.chmod(p, m),
    sha256: (b) => createHash('sha256').update(b).digest('hex'),
    exec: (cmd, args) =>
      new Promise((resolve, reject) =>
        execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(String(stdout)))),
      ),
    cliPath: process.env.FIGCRAFT_CLI || null,
    async connectCli(command, args) {
      // The default environment only: the CLI never sees the job token.
      const transport = new StdioClientTransport({ command, args, stderr: 'ignore' });
      const client = new Client({ name: 'greenfield-job', version: '1.0.0' });
      await client.connect(transport);
      return {
        call: (name, a) => client.callTool({ name, arguments: a }, undefined, { timeout: 120000 }),
        close: () => client.close(),
      };
    },
    async toolServer(tools, handler) {
      const mcp = new McpServer({ name: 'greenfield', version: '1.0.0' }, { capabilities: { tools: {} } });
      mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })),
      }));
      mcp.server.setRequestHandler(CallToolRequestSchema, async (req) =>
        handler(req.params.name, req.params.arguments || {}),
      );
      return { type: 'sdk', name: 'greenfield', instance: mcp };
    },
  };
}

if (process.argv[2] === 'run') process.exit(await main(await realDeps()));
`;
