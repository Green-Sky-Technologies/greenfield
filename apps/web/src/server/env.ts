/**
 * Environment variables renamed from CRUNCH_* to GREENFIELD_* (Story 1.1). For one release the old
 * name is still read, with a warning, so existing deployments keep working until their settings
 * are updated. Remove the fallback in the release after the rename.
 */
type Env = Record<string, string | undefined>;

export const RENAMED_ENV = {
  GREENFIELD_AI_GATEWAY: 'CRUNCH_AI_GATEWAY',
  GREENFIELD_APP_URL: 'CRUNCH_APP_URL',
  GREENFIELD_AWS_PRINCIPAL_ARN: 'CRUNCH_AWS_PRINCIPAL_ARN',
} as const;

export type RenamedEnvName = keyof typeof RENAMED_ENV;

const warned = new Set<string>();

/** The variable's value under its new name, else under its old CRUNCH_* name (with a warning). */
export function readEnv(name: RenamedEnvName, env: Env = process.env): string | undefined {
  const value = env[name];
  if (value !== undefined && value !== '') return value;
  const legacy = RENAMED_ENV[name];
  const old = env[legacy];
  if (old === undefined || old === '') return value;
  if (!warned.has(legacy)) {
    warned.add(legacy);
    console.warn(
      `[env] ${legacy} is deprecated; rename it to ${name}. The old name stops working in the next release.`,
    );
  }
  return old;
}
