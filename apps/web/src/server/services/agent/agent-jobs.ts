/**
 * Agent jobs (Story 4.5): "generate", "redesign" and "N alternatives" run in Vercel Sandbox with
 * the Claude Agent SDK and headless `figcraft-cli`, on a copy of the project's file. The result
 * comes back as an `agent` version for review; the document itself is never changed by a job.
 *
 *   startAgentJob     the request: a job row (and its chat message), started after the response
 *   prepareAgentJob   the sandbox spec: job token, prompt, tools, the CLI pin and the file copy
 *   saveAgentVersion  the sandbox uploads its saved file (job-token auth): an `agent` version
 *   loadFileVersion   the version's bytes, for the tab to open for review
 *
 * Safety (Story 4.6): the sandbox gets a job token for the LLM proxy, never a provider key
 * (`buildSandboxEnv`, `assertNoSecrets`), and the CLI is confined to the job folder.
 */
import { assertCan } from '@greenfield/authz';
import { resolveModel, systemPromptFor } from '@greenfield/agent';
import {
  jobInputs,
  toolDefinitions,
  type JobInput,
  type JobKind,
  type StartJob,
} from '@greenfield/contracts';
import { and, eq, fileVersions, jobs, type Db, type FileVersionRow } from '@greenfield/db';
import type { CliPin, JobToolDef, PreparedJob } from '@greenfield/sandbox-runner';
import editorRelease from '@greenfield/bridge/editor-release.json';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  designFilePrefix,
  loadDesignFile,
  MAX_DESIGN_FILE_BYTES,
  type DesignFileStorage,
} from '../design-files';
import { designSystemForTurn } from '../design-systems/follow';
import { createJob, jobActor } from '../jobs';
import { getModelSettings } from './model-settings';
import { issueJobToken, JobTokenError, verifyJobToken } from './job-tokens';
import { AgentUnavailableError, NotFoundError, ValidationError, type Actor } from '../types';

export const AGENT_JOB_KINDS = ['generate', 'redesign', 'alternatives'] as const;
export type AgentJobKind = (typeof AGENT_JOB_KINDS)[number];
const isAgentJob = (k: JobKind): k is AgentJobKind =>
  (AGENT_JOB_KINDS as readonly string[]).includes(k);

/** Agent SDK turns per job (each is one model call). */
export const JOB_MAX_TURNS = 40;

/**
 * The Linux `figcraft-cli` the sandbox runs, pinned by sha256. It ships with the fork's release
 * (`editor-release.json` → `cli`, lane W1-A); GREENFIELD_FIGCRAFT_CLI_URL and _SHA256 override it,
 * and GREENFIELD_FIGCRAFT_CLI_URL=off runs without one (the app e2e suite, so it starts no sandbox).
 */
export function editorCliPin(
  env: Record<string, string | undefined> = process.env,
  release: { cli?: Partial<CliPin> } = editorRelease as { cli?: Partial<CliPin> },
): CliPin | null {
  if (env.GREENFIELD_FIGCRAFT_CLI_URL === 'off') return null;
  const url = env.GREENFIELD_FIGCRAFT_CLI_URL || release.cli?.url;
  const sha256 = env.GREENFIELD_FIGCRAFT_CLI_SHA256 || release.cli?.sha256;
  if (!url || !sha256 || !/^[0-9a-f]{64}$/.test(sha256) || !url.startsWith('https://')) return null;
  return { url, sha256 };
}

/** The job tools: the contract's, less what needs a person (comments live in the tab). */
export function jobTools(): JobToolDef[] {
  return toolDefinitions('job')
    .filter((d) => d.name !== 'comment_thread')
    .map((d) => ({ name: d.name, description: d.description, input_schema: d.input_schema }));
}

/** The brief a job's agent starts from. */
export function jobPrompt(kind: AgentJobKind, input: unknown): string {
  const place =
    'Place new frames to the right of the existing top-level frames, 120 px apart, never overlapping them.';
  const finish =
    'Build each frame in one run_batch, render it once, fix what looks off, then finish with a two-sentence summary.';
  switch (kind) {
    case 'generate': {
      const i = input as JobInput<'generate'>;
      const n = i.frameCount ?? 1;
      return [
        `Create ${n === 1 ? 'one new top-level frame' : `${n} new top-level frames`} on the current page for this brief:`,
        i.prompt,
        'Read the page outline first and match the existing frames: their width, fonts, colours, spacing and components.',
        place,
        finish,
      ].join('\n\n');
    }
    case 'redesign': {
      const i = input as JobInput<'redesign'>;
      return [
        `Redesign these frames in place: ${i.frameIds.join(', ')}. The brief:`,
        i.prompt,
        'Keep each frame, its name and its position; rework its layers. Keep the file’s fonts, colours and components.',
        finish,
      ].join('\n\n');
    }
    case 'alternatives': {
      const i = input as JobInput<'alternatives'>;
      const letters = 'ABCDE'.slice(0, i.count).split('').join(', ');
      return [
        `Make ${i.count} alternative designs of frame ${i.frameId}, each a different direction.`,
        i.prompt
          ? `The brief: ${i.prompt}`
          : 'Pick directions that differ in layout, not just colour.',
        `Read the frame first. Build each alternative as a new top-level frame with the same width, named "<original name> ${letters.split(', ')[0]} · <direction in 2–4 words>" (letters ${letters}). Leave the original unchanged.`,
        place,
        finish,
      ].join('\n\n');
    }
  }
}

export const startAgentJobInput = z
  .object({
    kind: z.enum(AGENT_JOB_KINDS),
    input: z.unknown(),
    projectId: z.uuid(),
    conversationId: z.uuid().optional(),
    messageId: z.uuid().optional(),
  })
  .strict();

/**
 * Queue an agent job for a project. The route starts it after the response (`startJob`); the
 * client follows `/api/jobs/:id/events` (resumable) and can cancel it. Other job kinds (design
 * system import, codegen, …) are not agent jobs and stay unavailable here.
 */
export async function startAgentJob(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor.role, 'agent:run');
  const kind = (raw as { kind?: unknown } | null)?.kind;
  if (typeof kind === 'string' && kind in jobInputs && !isAgentJob(kind as JobKind))
    throw new AgentUnavailableError(`${kind} jobs are not available yet.`);
  const parsed = startAgentJobInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid job');
  return createJob(db, actor, parsed.data);
}

/** Build a job's sandbox spec. Throws for jobs the sandbox can't run (startJob fails them). */
export async function prepareAgentJob(
  db: Db,
  storage: DesignFileStorage,
  job: StartJob,
  env: Record<string, string | undefined> = process.env,
  release?: { cli?: Partial<CliPin> },
): Promise<PreparedJob> {
  if (!isAgentJob(job.kind))
    throw new AgentUnavailableError(`${job.kind} jobs are not available yet.`);
  const cli = editorCliPin(env, release);
  if (!cli)
    throw new AgentUnavailableError(
      'Agent jobs need the headless editor (a Linux figcraft-cli pinned in editor-release.json), which this deployment does not have yet.',
    );
  const [row] = await db.select().from(jobs).where(eq(jobs.id, job.jobId)).limit(1);
  if (!row?.projectId) throw new ValidationError('An agent job needs a project');
  const actor = await jobActor(db, row);
  const file = await loadDesignFile(db, actor, storage, { projectId: row.projectId });
  const settings = await getModelSettings(db, row.workspaceId);
  const designSystem = await designSystemForTurn(db, actor, row.projectId);
  // Valid past the job's own timeout: the reaper ends the job (and revokes it) first.
  const { token } = await issueJobToken(db, job.jobId, job.timeoutSeconds + 300);
  return {
    jobToken: token,
    model: resolveModel(settings, 'generation'),
    smallModel: resolveModel(settings, 'utility'),
    spec: {
      prompt: jobPrompt(job.kind, job.input),
      systemPrompt: designSystem
        ? `${systemPromptFor('job')}\n\n${designSystem.prompt}`
        : systemPromptFor('job'),
      tools: jobTools(),
      maxTurns: JOB_MAX_TURNS,
      cli,
      newDocument: !file,
    },
    document: file?.bytes ?? null,
  };
}

/** A version's display name: what the job was asked for. */
function versionName(job: { kind: JobKind; input: unknown }): string {
  const prompt = String((job.input as { prompt?: unknown }).prompt ?? '').trim();
  const label = { generate: 'Generated', redesign: 'Redesign', alternatives: 'Alternatives' }[
    job.kind as AgentJobKind
  ];
  return `${label ?? 'Agent'}${prompt ? `: ${prompt.slice(0, 60)}` : ''}`;
}

/**
 * PUT /api/jobs/:id/file: the job's saved document becomes an `agent` version of the project.
 * Only the running job's own token may upload, once.
 */
export async function saveAgentVersion(
  db: Db,
  storage: DesignFileStorage,
  token: string | null,
  jobId: string,
  bytes: Uint8Array,
): Promise<{ versionId: string }> {
  const job = await verifyJobToken(db, token);
  if (job.id !== jobId) throw new JobTokenError('Token is for a different job');
  if (!job.projectId || !isAgentJob(job.kind)) throw new ValidationError('Not an agent job');
  if (!bytes.length || bytes.length > MAX_DESIGN_FILE_BYTES)
    throw new ValidationError('Invalid document size');
  const [existing] = await db
    .select({ id: fileVersions.id })
    .from(fileVersions)
    .where(eq(fileVersions.jobId, jobId))
    .limit(1);
  if (existing) throw new ValidationError('This job already saved its result');
  const blobKey = `${designFilePrefix(job.workspaceId, job.projectId)}versions/${randomUUID()}.figcraft`;
  await storage.put(blobKey, bytes);
  const [row] = await db
    .insert(fileVersions)
    .values({
      workspaceId: job.workspaceId,
      projectId: job.projectId,
      kind: 'agent',
      name: versionName(job),
      blobKey,
      size: bytes.length,
      jobId,
      createdBy: job.createdBy,
    })
    .returning({ id: fileVersions.id });
  return { versionId: row!.id };
}

export interface FileVersionView {
  id: string;
  projectId: string;
  kind: FileVersionRow['kind'];
  name: string | null;
  size: number;
  jobId: string | null;
  createdAt: string;
}

async function findVersion(db: Db, actor: Actor, versionId: string): Promise<FileVersionRow> {
  assertCan(actor.role, 'project:read');
  if (!z.uuid().safeParse(versionId).success) throw new NotFoundError('Version not found');
  const [row] = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.id, versionId), eq(fileVersions.workspaceId, actor.workspace.id)))
    .limit(1);
  if (!row) throw new NotFoundError('Version not found');
  return row;
}

/** A version's bytes, for the tab to open it for review. */
export async function loadFileVersion(
  db: Db,
  actor: Actor,
  storage: DesignFileStorage,
  versionId: string,
): Promise<{ version: FileVersionView; body: ReadableStream<Uint8Array>; size: number }> {
  const row = await findVersion(db, actor, versionId);
  const r = await storage.read(row.blobKey);
  if (!r) throw new NotFoundError('Version not found');
  return {
    version: {
      id: row.id,
      projectId: row.projectId,
      kind: row.kind,
      name: row.name,
      size: row.size,
      jobId: row.jobId,
      createdAt: row.createdAt.toISOString(),
    },
    body: r.body,
    size: r.size,
  };
}
