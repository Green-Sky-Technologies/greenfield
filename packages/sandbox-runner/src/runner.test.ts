import { describe, expect, it, vi } from 'vitest';
import {
  assertNoSecrets,
  JOB_INPUT_PATH,
  JOB_SPEC_PATH,
  recordingSandboxApi,
  SandboxSecretError,
  VercelSandboxRunner,
  type PreparedJob,
} from './index';

const job = {
  jobId: '11111111-1111-4111-8111-111111111111',
  workspaceId: 'ws',
  kind: 'generate' as const,
  input: { prompt: 'x' },
  timeoutSeconds: 600,
};

const prepared = (over: Partial<PreparedJob['spec']> = {}): PreparedJob => ({
  jobToken: 'cjt_test-token',
  model: 'claude-opus-5-5',
  smallModel: 'claude-haiku-5-5',
  spec: {
    prompt: 'Design a pricing page',
    systemPrompt: 'sys',
    tools: [{ name: 'get_outline', description: 'Outline', input_schema: { type: 'object' } }],
    maxTurns: 40,
    cli: {
      url: 'https://github.com/o/r/releases/download/v1/figcraft-cli',
      sha256: 'ab'.repeat(32),
    },
    newDocument: false,
    ...over,
  },
  document: new TextEncoder().encode('FIGCRAFT-BYTES'),
});

describe('VercelSandboxRunner', () => {
  it('starts a locked-down sandbox with only the proxy URL and a job token', async () => {
    const realKey = 'sk-ant-api03-' + 'R'.repeat(40);
    vi.stubEnv('ANTHROPIC_API_KEY', realKey);
    const api = recordingSandboxApi();
    const runner = new VercelSandboxRunner({
      appUrl: 'https://app.example.com/',
      api,
      prepare: async () => prepared(),
    });
    const { sandboxId } = await runner.start(job);
    const rec = api.sandboxes.get(sandboxId)!;
    expect(rec.params).toMatchObject({
      timeout: 600_000,
      persistent: false,
      networkPolicy: {
        allow: [
          'app.example.com',
          'registry.npmjs.org',
          'github.com',
          'release-assets.githubusercontent.com',
          'objects.githubusercontent.com',
        ],
      },
      env: {
        ANTHROPIC_BASE_URL: 'https://app.example.com/api/llm',
        ANTHROPIC_AUTH_TOKEN: 'cjt_test-token',
        ANTHROPIC_MODEL: 'claude-opus-5-5',
        GREENFIELD_JOB_ID: job.jobId,
      },
    });
    expect(rec.params.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(JSON.stringify(rec)).not.toContain(realKey);
    expect(rec.files.map((f) => f.path)).toContain(JOB_SPEC_PATH);
    // The copy of the file goes into the job's folder, the only one the editor may touch.
    expect(rec.files.find((f) => f.path === JOB_INPUT_PATH)!.content).toBe('FIGCRAFT-BYTES');
    expect(JSON.parse(rec.files.find((f) => f.path === JOB_SPEC_PATH)!.content).cli).toEqual(
      prepared().spec.cli,
    );
    expect(rec.commands[0]).toMatchObject({ cmd: 'bash', detached: true });
    expect(await runner.isAlive(sandboxId)).toBe(true);
    await runner.cancel(job.jobId, sandboxId);
    expect(rec.stopped).toBe(true);
    expect(await runner.isAlive(sandboxId)).toBe(false);
    expect(await runner.isAlive('missing')).toBe(false);
    vi.unstubAllEnvs();
  });

  it('refuses to start when anything sent to the sandbox looks like a credential', async () => {
    const api = recordingSandboxApi();
    const runner = new VercelSandboxRunner({
      appUrl: 'https://app.example.com',
      api,
      prepare: async () => prepared({ prompt: 'use sk-ant-api03-LEAKEDLEAKEDLEAKED' }),
    });
    await expect(runner.start(job)).rejects.toBeInstanceOf(SandboxSecretError);
    expect(api.sandboxes.size).toBe(0);
    expect(() => assertNoSecrets({ AWS_SECRET_ACCESS_KEY: 'x' })).toThrow(SandboxSecretError);
    expect(() =>
      assertNoSecrets({ OK: 'fine' }, [{ path: 'a', content: '"private_key": "x"' }]),
    ).toThrow();
  });
});

describe('assertNoSecrets patterns (defense in depth)', () => {
  const fake = (prefix: string, n: number, ch = 'A') => prefix + ch.repeat(n);
  it.each([
    ['STS key id', { X: fake('ASIA', 16) }],
    ['AWS key id', { X: fake('AKIA', 16) }],
    ['AWS secret key shape', { X: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }],
    ['Azure/Foundry key', { X: '0123456789abcdef0123456789abcdef' }],
    ['Stripe live key', { X: fake('sk_live_', 24, 'x') }],
    ['GitHub token', { X: fake('ghp_', 36, 'x') }],
    ['Google API key', { X: fake('AIza', 35, 'x') }],
    ['forbidden name', { AZURE_OPENAI_KEY: 'x' }],
    ['forbidden name (Foundry)', { ANTHROPIC_FOUNDRY_API_KEY: 'x' }],
  ])('rejects %s in env', (_l, env) => {
    expect(() => assertNoSecrets(env as Record<string, string>)).toThrow(SandboxSecretError);
  });

  it('rejects distinctive shapes inside files, but not ordinary prompts', () => {
    expect(() =>
      assertNoSecrets({}, [{ path: 'job.json', content: `use ${fake('rk_test_', 20, 'y')}` }]),
    ).toThrow();
    expect(() =>
      assertNoSecrets({}, [{ path: 'job.json', content: `token ${fake('ASIA', 16, 'Q')} here` }]),
    ).toThrow();
    expect(() =>
      assertNoSecrets(
        {
          ANTHROPIC_AUTH_TOKEN: 'cjt_' + 'a'.repeat(43),
          GREENFIELD_JOB_ID: '11111111-1111-4111-8111-111111111111',
          ANTHROPIC_MODEL: 'claude-opus-5-5',
        },
        [
          {
            path: 'job.json',
            content:
              'Design a pricing page with three tiers and a 0123456789abcdef0123456789abcdef hash',
          },
        ],
      ),
    ).not.toThrow();
  });
});
