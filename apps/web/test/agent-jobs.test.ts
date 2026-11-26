/**
 * Story 4.5 (agent jobs) and 4.6 (sandbox safety) against real Postgres. The sandbox is
 * `recordingSandboxApi`; the end-to-end case runs the real entrypoint source in-process with a
 * fake headless editor and a fake Agent SDK, its HTTP calls answered by the services the routes
 * call.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError } from '@greenfield/authz';
import { parseSse } from '@greenfield/agent';
import { generateMasterKey, parseKeyring } from '@greenfield/crypto';
import { agentConversations, agentMessages, eq, fileVersions, jobs } from '@greenfield/db';
import {
  ENTRYPOINT_SOURCE,
  JOB_INPUT_PATH,
  JOB_SPEC_PATH,
  recordingSandboxApi,
  VercelSandboxRunner,
  type SandboxApi,
} from '@greenfield/sandbox-runner';
import {
  editorCliPin,
  jobTools,
  loadFileVersion,
  prepareAgentJob,
  saveAgentVersion,
  startAgentJob,
} from '@/server/services/agent/agent-jobs';
import { JobTokenError } from '@/server/services/agent/job-tokens';
import { prepareJob } from '@/server/services/agent/runner';
import { saveCredential } from '@/server/services/credentials';
import { localFsStorage, saveDesignFile } from '@/server/services/design-files';
import { acquireLock } from '@/server/services/locks';
import {
  cancelJob,
  getJob,
  jobEventFrames,
  reportJobEvent,
  startJob,
} from '@/server/services/jobs';
import { createProject } from '@/server/services/projects';
import { upsertMember } from '@/server/services/workspaces';
import { AgentUnavailableError, NotFoundError, ValidationError } from '@/server/services/types';
import { makeActor, reset, testDb } from './helpers';

const { db, close } = testDb();
afterAll(close);
beforeEach(() => reset(db));

const PIN = {
  GREENFIELD_FIGCRAFT_CLI_URL:
    'https://github.com/Green-Sky-Technologies/greenfield-editor/releases/download/v1/figcraft-cli',
  GREENFIELD_FIGCRAFT_CLI_SHA256: 'b'.repeat(64),
};

async function setup() {
  const editor = await makeActor(db, 'editor');
  await upsertMember(db, editor.workspace.id, editor.userId, 'editor');
  const project = await createProject(db, editor, { name: 'Voirdire' });
  const storage = localFsStorage(mkdtempSync(join(tmpdir(), 'gf-blob-')));
  const [conv] = await db
    .insert(agentConversations)
    .values({ workspaceId: editor.workspace.id, projectId: project.id, createdBy: editor.userId })
    .returning();
  const [msg] = await db
    .insert(agentMessages)
    .values({
      conversationId: conv!.id,
      workspaceId: editor.workspace.id,
      seq: 1,
      role: 'assistant',
      content: { v: 1, turns: [] },
      status: 'pending',
    })
    .returning();
  return { editor, project, storage, conversationId: conv!.id, messageId: msg!.id };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** Save `bytes` as the project's document (through the edit lock, as the tab does). */
async function saveDoc(s: Setup, bytes: Uint8Array) {
  await acquireLock(db, s.editor, s.project.id, { sessionId: 'tab_aaaaaaaa' });
  await saveDesignFile(db, s.editor, s.storage, {
    projectId: s.project.id,
    sessionId: 'tab_aaaaaaaa',
    bytes,
  });
}

const alternatives = (s: Setup) => ({
  kind: 'alternatives',
  projectId: s.project.id,
  conversationId: s.conversationId,
  messageId: s.messageId,
  input: { prompt: 'Pricing layouts', frameId: '12', count: 3 },
});

describe('agent jobs (Story 4.5)', () => {
  it('starts only agent jobs, for editors', async () => {
    const s = await setup();
    const viewer = await makeActor(db, 'viewer', s.editor.workspace);
    await expect(startAgentJob(db, viewer, alternatives(s))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      startAgentJob(db, s.editor, { kind: 'codegen', projectId: s.project.id, input: {} }),
    ).rejects.toBeInstanceOf(AgentUnavailableError);
    await expect(
      startAgentJob(db, s.editor, { ...alternatives(s), input: { frameId: '1', count: 9 } }),
    ).rejects.toBeInstanceOf(ValidationError);
    const job = await startAgentJob(db, s.editor, alternatives(s));
    expect(job).toMatchObject({ kind: 'alternatives', status: 'queued' });
  });

  it('fails at once, without retries, when no CLI is pinned', async () => {
    const s = await setup();
    const job = await startAgentJob(db, s.editor, alternatives(s));
    const api = recordingSandboxApi();
    const runner = new VercelSandboxRunner({
      appUrl: 'https://app.example.com',
      api,
      prepare: (j) => prepareAgentJob(db, s.storage, j, {}, {}),
    });
    expect(await startJob(db, job.id, { runner })).toMatchObject({ status: 'failed' });
    expect((await getJob(db, s.editor, job.id)).error).toContain('figcraft-cli');
    expect(api.sandboxes.size).toBe(0);
    expect(editorCliPin({}, {})).toBeNull();
    expect(editorCliPin({}, { cli: { url: 'https://x/cli', sha256: 'c'.repeat(64) } })).toEqual({
      url: 'https://x/cli',
      sha256: 'c'.repeat(64),
    });
    expect(
      editorCliPin(
        { GREENFIELD_FIGCRAFT_CLI_URL: 'off' },
        { cli: { url: 'https://x/cli', sha256: 'c'.repeat(64) } },
      ),
    ).toBeNull();
  });

  it('fails at once, without retries, when a sandbox could not call this app back', async () => {
    const s = await setup();
    const job = await startAgentJob(db, s.editor, alternatives(s));
    const api = recordingSandboxApi();
    const runner = new VercelSandboxRunner({
      appUrl: 'http://localhost:3000',
      api,
      prepare: (j) => prepareJob(j, { ...PIN, PORT: '3000' }, db, s.storage),
    });
    expect(await startJob(db, job.id, { runner })).toMatchObject({ status: 'failed' });
    const failed = await getJob(db, s.editor, job.id);
    expect(failed.error).toContain('GREENFIELD_APP_URL');
    expect(failed.attempts).toBe(1);
    expect(api.sandboxes.size).toBe(0);
  });

  it('sends a copy of the file, the pin and the contract tools; no provider key (4.6)', async () => {
    const s = await setup();
    const admin = await makeActor(db, 'admin', s.editor.workspace);
    const realKey = 'sk-ant-api03-' + 'Z'.repeat(40) + 'REAL';
    await saveCredential(
      db,
      admin,
      { provider: 'anthropic', apiKey: realKey },
      { keyring: parseKeyring(`t1:${generateMasterKey()}`) },
    );
    await saveDoc(s, new TextEncoder().encode('FIGCRAFT-DOCUMENT'));
    const job = await startAgentJob(db, s.editor, alternatives(s));
    const api = recordingSandboxApi();
    const runner = new VercelSandboxRunner({
      appUrl: 'https://app.example.com',
      api,
      prepare: (j) => prepareAgentJob(db, s.storage, j, { ...PIN, ANTHROPIC_API_KEY: realKey }),
    });
    expect(await startJob(db, job.id, { runner })).toMatchObject({ status: 'running' });
    const [rec] = [...api.sandboxes.values()];
    expect(JSON.stringify(rec)).not.toContain(realKey);
    expect(rec!.params.env.ANTHROPIC_BASE_URL).toBe('https://app.example.com/api/llm');
    expect(rec!.files.find((f) => f.path === JOB_INPUT_PATH)!.content).toBe('FIGCRAFT-DOCUMENT');
    const spec = JSON.parse(rec!.files.find((f) => f.path === JOB_SPEC_PATH)!.content);
    expect(spec).toMatchObject({
      kind: 'alternatives',
      newDocument: false,
      cli: { url: PIN.GREENFIELD_FIGCRAFT_CLI_URL, sha256: PIN.GREENFIELD_FIGCRAFT_CLI_SHA256 },
    });
    expect(spec.prompt).toContain('Make 3 alternative designs of frame 12');
    expect(spec.tools.map((t: { name: string }) => t.name)).toEqual(jobTools().map((t) => t.name));
    expect(spec.tools.map((t: { name: string }) => t.name)).toContain('run_batch');
    expect(spec.tools.map((t: { name: string }) => t.name)).not.toContain('ask_followup');
    expect(rec!.params.networkPolicy.allow).toContain('release-assets.githubusercontent.com');
  });

  it('stores the uploaded result as an agent version, once, for its own job only', async () => {
    const s = await setup();
    const job = await startAgentJob(db, s.editor, alternatives(s));
    const other = await startAgentJob(db, s.editor, { ...alternatives(s), messageId: undefined });
    const runner = new VercelSandboxRunner({
      appUrl: 'https://app.example.com',
      api: recordingSandboxApi(),
      prepare: (j) => prepareAgentJob(db, s.storage, j, PIN),
    });
    await startJob(db, job.id, { runner });
    await startJob(db, other.id, { runner });
    const [tok] = [...(await tokens(runner))];
    const bytes = new TextEncoder().encode('RESULT');

    await expect(saveAgentVersion(db, s.storage, 'cjt_nope', job.id, bytes)).rejects.toBeInstanceOf(
      JobTokenError,
    );
    await expect(saveAgentVersion(db, s.storage, tok!, other.id, bytes)).rejects.toBeInstanceOf(
      JobTokenError,
    );
    const { versionId } = await saveAgentVersion(db, s.storage, tok!, job.id, bytes);
    await expect(saveAgentVersion(db, s.storage, tok!, job.id, bytes)).rejects.toBeInstanceOf(
      ValidationError,
    );
    const [row] = await db.select().from(fileVersions).where(eq(fileVersions.id, versionId));
    expect(row).toMatchObject({ kind: 'agent', jobId: job.id, projectId: s.project.id });
    expect(row!.name).toBe('Alternatives: Pricing layouts');

    const viewer = await makeActor(db, 'viewer', s.editor.workspace);
    const v = await loadFileVersion(db, viewer, s.storage, versionId);
    expect(new Uint8Array(await new Response(v.body).arrayBuffer())).toEqual(bytes);
    const outsider = await makeActor(db, 'editor');
    await expect(loadFileVersion(db, outsider, s.storage, versionId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('end to end: progress streams, the result is a version, the chat shows the summary', async () => {
    const s = await setup();
    await saveDoc(s, new TextEncoder().encode('FIGCRAFT-DOCUMENT'));
    const job = await startAgentJob(db, s.editor, alternatives(s));
    const sandbox = inProcessSandbox(s);
    const runner = new VercelSandboxRunner({
      appUrl: 'https://app.example.com',
      api: sandbox.api,
      prepare: (j) => prepareAgentJob(db, s.storage, j, PIN),
    });
    await startJob(db, job.id, { runner });
    expect(await sandbox.done).toBe(0);

    const view = await getJob(db, s.editor, job.id);
    expect(view.status).toBe('succeeded');
    const result = view.result as {
      versionId: string;
      frames: { name: string }[];
      summary: string;
    };
    expect(result.frames.map((f) => f.name)).toEqual(['Pricing A · Cards', 'Pricing B · Table']);
    const [version] = await db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.id, result.versionId));
    expect(version).toMatchObject({ kind: 'agent', jobId: job.id });
    // The editor got the copy of the file, confined to the job folder.
    expect(sandbox.cliArgs()).toEqual([
      'mcp',
      '--automation-read-root',
      '/vercel/sandbox/work',
      '--automation-write-root',
      '/vercel/sandbox/work',
    ]);

    // The events replay from the start after the tab comes back.
    let text = '';
    for await (const f of jobEventFrames(db, s.editor, job.id, 0, { pollMs: 5 })) text += f;
    const events = parseSse(text).map((e) => e.event);
    expect(events).toContain('progress');
    expect(events).toContain('tool');
    expect(events.at(-1)).toBe('done');

    const [msg] = await db.select().from(agentMessages).where(eq(agentMessages.id, s.messageId));
    expect(msg!.status).toBe('complete');
    expect(JSON.stringify(msg!.content)).toContain('Created 2 frames: Pricing A · Cards');
  });

  it('cancel stops the sandbox; a late result is refused', async () => {
    const s = await setup();
    const job = await startAgentJob(db, s.editor, alternatives(s));
    const api = recordingSandboxApi();
    const runner = new VercelSandboxRunner({
      appUrl: 'https://app.example.com',
      api,
      prepare: (j) => prepareAgentJob(db, s.storage, j, PIN),
    });
    await startJob(db, job.id, { runner });
    const [tok] = [...(await tokens(runner))];
    expect((await cancelJob(db, s.editor, job.id, { runner })).status).toBe('cancelled');
    expect([...api.sandboxes.values()][0]!.stopped).toBe(true);
    await expect(
      reportJobEvent(db, tok!, job.id, { type: 'result', data: { summary: 'late' } }),
    ).rejects.toBeInstanceOf(JobTokenError);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row!.status).toBe('cancelled');
  });
});

/** The job tokens the runner put in its sandboxes' env. */
async function tokens(runner: VercelSandboxRunner): Promise<string[]> {
  const api = (runner as unknown as { opts: { api: ReturnType<typeof recordingSandboxApi> } }).opts
    .api;
  return [...api.sandboxes.values()].map((r) => r.params.env.ANTHROPIC_AUTH_TOKEN!);
}

/**
 * A sandbox that runs the real entrypoint source in this process: its report and upload calls
 * go to the services, the editor is a fake that makes two frames, the Agent SDK a fake that
 * calls run_batch twice.
 */
function inProcessSandbox(s: Setup) {
  const rec = recordingSandboxApi();
  let finish!: (code: number) => void;
  const done = new Promise<number>((r) => (finish = r));
  let args: string[] = [];
  const api: SandboxApi = {
    get: (name) => rec.get(name),
    async create(params) {
      const handle = await rec.create(params);
      const sandbox = rec.sandboxes.get(handle.name)!;
      return {
        ...handle,
        name: handle.name,
        status: 'running',
        writeFiles: (f) => handle.writeFiles(f),
        stop: () => handle.stop(),
        async runCommand(p) {
          await handle.runCommand(p);
          const dir = join(tmpdir(), `gf-entry-${Math.random().toString(36).slice(2)}`);
          mkdirSync(dir);
          writeFileSync(join(dir, 'entry.mjs'), ENTRYPOINT_SOURCE);
          const { main } = (await import(pathToFileURL(join(dir, 'entry.mjs')).href)) as {
            main: (d: unknown) => Promise<number>;
          };
          const files = new Map(sandbox.files.map((f) => [f.path, f.content]));
          let frames = [{ id: 12, name: 'Pricing' }];
          const call = async (name: string, a: Record<string, unknown>) => {
            if (name === 'inspect_document')
              return text({ currentPage: 1, pages: [{ id: 1, children: frames }] });
            if (name === 'batch') {
              const n = frames.length;
              frames = [...frames, { id: 100 + n, name: String(a.label) }];
            }
            return text({ ok: true });
          };
          const env = params.env;
          void main({
            env,
            readFile: async (path: string) =>
              path === JOB_SPEC_PATH ? files.get(path) : new TextEncoder().encode('RESULT'),
            mkdir: async () => {},
            writeFile: async () => {},
            chmod: async () => {},
            exec: async () => '',
            // The download and sha256 check are the sandbox-runner tests' (entrypoint.test.ts).
            cliPath: '/vercel/sandbox/bin/figcraft-cli',
            connectCli: async (_c: string, a: string[]) => {
              args = a;
              return { call, close: async () => {} };
            },
            toolServer: async (
              _t: unknown,
              handler: (n: string, i: unknown) => Promise<unknown>,
            ) => ({
              handler,
            }),
            query: ({
              options,
            }: {
              options: {
                mcpServers: {
                  greenfield: { handler: (n: string, i: unknown) => Promise<unknown> };
                };
              };
            }) =>
              (async function* () {
                for (const label of ['Pricing A · Cards', 'Pricing B · Table']) {
                  yield {
                    type: 'assistant',
                    message: {
                      content: [{ type: 'tool_use', name: 'mcp__greenfield__run_batch' }],
                    },
                  };
                  await options.mcpServers.greenfield.handler('run_batch', { label, commands: [] });
                }
                yield { type: 'result', subtype: 'success', result: 'Two directions.' };
              })(),
            fetch: async (url: string, init?: RequestInit) => {
              const token = (init?.headers as Record<string, string>).authorization.slice(7);
              const jobId = url.split('/api/jobs/')[1]!.split('/')[0]!;
              try {
                if (url.endsWith('/file')) {
                  const body = init!.body as Uint8Array;
                  return Response.json(await saveAgentVersion(db, s.storage, token, jobId, body));
                }
                return Response.json(
                  await reportJobEvent(db, token, jobId, JSON.parse(String(init!.body))),
                );
              } catch (e) {
                return new Response(String(e), { status: e instanceof JobTokenError ? 401 : 500 });
              }
            },
          }).then(finish);
          return {};
        },
      };
    },
  };
  return { api, done, cliArgs: () => args };
}

const text = (v: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
