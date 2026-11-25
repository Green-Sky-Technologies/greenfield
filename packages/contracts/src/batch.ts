/**
 * `run_batch` input: editor commands run as one undo step through the bridge's `batch`
 * (`command.batch`). Checked before anything reaches the editor:
 *
 * - every `command` is in the pinned editor's command list (`COMMANDS`, generated in
 *   `packages/bridge`) and not blocked for the agent (`agentCommandBlocked`);
 * - `params` keys are ones the command takes (`node.set`: `NODE_SET_PROPS`), as the editor checks;
 * - `as` names are unique, and every reference points at an earlier step: `{"$ref": name}` or
 *   `{"$step": n}`, each with an optional `field` (`"id"` by default, or a path like `"ids/0"`).
 *   This is exactly what the bridge's `batch` accepts (`ref()` / `step()`).
 */
import { COMMANDS, NODE_SET_PROPS, type CommandInfo } from '@greenfield/bridge';
import { z } from 'zod';

const COMMAND_META: ReadonlyMap<string, CommandInfo> = new Map(COMMANDS.map((c) => [c.id, c]));
const SET_PROPS: ReadonlySet<string> = new Set(NODE_SET_PROPS);

/**
 * Command families the agent never runs: files, app and window chrome, preferences, viewport and
 * tools (the person's view, not the document), collaboration, versions and branches, exports
 * (Epic 7), plugins, and comments (`comment_thread` writes those, with the agent as author).
 */
export const AGENT_BLOCKED_PREFIXES = [
  'app.',
  'branch.',
  'collab.',
  'comment.',
  'export.',
  'file.',
  'help.',
  'plugin.',
  'plugins.',
  'pref.',
  'tool.',
  'version.',
  'view.',
  'window.',
] as const;

/** Single commands the agent never runs: a nested batch, and undo/redo (the person's history). */
export const AGENT_BLOCKED_COMMANDS: ReadonlySet<string> = new Set([
  'command.batch',
  'edit.redo',
  'edit.undo',
]);

/** Why the agent may not run `command` (null when it may). */
export function agentCommandBlocked(
  command: string,
  allowed?: ReadonlySet<string> | null,
): string | null {
  if (!COMMAND_META.has(command))
    return `unknown command \`${command}\`; find commands with list_commands`;
  if (
    AGENT_BLOCKED_COMMANDS.has(command) ||
    AGENT_BLOCKED_PREFIXES.some((p) => command.startsWith(p))
  )
    return `\`${command}\` is not available to the agent`;
  if (allowed && !allowed.has(command)) return `\`${command}\` is not allowed here`;
  return null;
}

/**
 * The steps with `select: false` on every command that would select what it makes (`node.create`
 * and the like select by default). The selection is the person's; Claude never moves it.
 */
export const keepSelection = (steps: readonly BatchStepInput[]): BatchStepInput[] =>
  steps.map((s) =>
    COMMAND_META.get(s.command)?.takes?.includes('select')
      ? { ...s, params: { ...s.params, select: false } }
      : s,
  );

/** Pinned command metadata (`takes`, `undoable`, the parameter doc). */
export const commandInfo = (command: string): CommandInfo | undefined => COMMAND_META.get(command);

/**
 * The commands the agent's prompt documents (Story 0.3 `curated` list); `list_commands` finds
 * the rest. Not an allow-list: pass `allowedCommands` to `executeTool` for that.
 */
export const COMMAND_REFERENCE = [
  'edit.delete',
  'edit.duplicate',
  'effect.add',
  'layout.setTrack',
  'node.create',
  'node.find',
  'node.get',
  'node.reorder',
  'node.reparent',
  'node.set',
  'text.set',
  'text.style',
] as const;

export const STEP_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;

export const batchStep = z
  .object({
    command: z.string().min(1).max(80).describe('Command id, e.g. "node.set"'),
    params: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('The command\'s parameters. Any value may be {"$ref": name} or {"$step": n}'),
    as: z
      .string()
      .regex(STEP_NAME, 'names are 1-40 letters, digits, "_" or "-", starting with a letter or "_"')
      .optional()
      .describe('Name this step so later steps can reference its result'),
  })
  .strict();
export type BatchStepInput = z.infer<typeof batchStep>;

export const runBatchInput = z
  .object({
    label: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe('The undo step\'s label, e.g. "Tighten hero spacing"'),
    commands: z.array(batchStep).min(1).max(200),
  })
  .strict()
  .superRefine((v, ctx) => {
    const names = new Map<string, number>();
    v.commands.forEach((s, i) => {
      const at = ['commands', i];
      const blocked = agentCommandBlocked(s.command);
      if (blocked) ctx.addIssue({ code: 'custom', path: [...at, 'command'], message: blocked });
      else
        checkParams(s.command, s.params ?? {}, (path, message) =>
          ctx.addIssue({ code: 'custom', path: [...at, 'params', ...path], message }),
        );
      checkRefs(s.params ?? {}, i, names, (path, message) =>
        ctx.addIssue({ code: 'custom', path: [...at, 'params', ...path], message }),
      );
      if (s.as !== undefined) {
        if (names.has(s.as))
          ctx.addIssue({
            code: 'custom',
            path: [...at, 'as'],
            message: `the name \`${s.as}\` is used twice`,
          });
        else names.set(s.as, i);
      }
    });
  });
export type RunBatchInput = z.infer<typeof runBatchInput>;

type Report = (path: (string | number)[], message: string) => void;

function checkParams(command: string, params: Record<string, unknown>, report: Report): void {
  if (command === 'node.set') {
    for (const k of Object.keys(params))
      if (!['id', 'ids', 'props'].includes(k) && !SET_PROPS.has(k))
        report([k], `\`node.set\` has no property \`${k}\``);
    const props = params.props;
    if (props && typeof props === 'object' && !Array.isArray(props) && !isRefValue(props))
      for (const k of Object.keys(props))
        if (!SET_PROPS.has(k)) report(['props', k], `\`node.set\` has no property \`${k}\``);
    return;
  }
  const takes = COMMAND_META.get(command)?.takes;
  if (!takes) return;
  for (const k of Object.keys(params))
    if (k !== 'id' && k !== 'ids' && !takes.includes(k))
      report(
        [k],
        `\`${command}\` has no parameter \`${k}\` (it takes ${takes.length ? takes.join(', ') : 'none'})`,
      );
}

const isRefValue = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && ('$ref' in v || '$step' in v);

function checkRefs(
  v: unknown,
  at: number,
  names: ReadonlyMap<string, number>,
  report: Report,
  path: (string | number)[] = [],
): void {
  if (Array.isArray(v)) {
    v.forEach((x, i) => checkRefs(x, at, names, report, [...path, i]));
    return;
  }
  if (!v || typeof v !== 'object') return;
  if (!isRefValue(v)) {
    for (const [k, x] of Object.entries(v)) checkRefs(x, at, names, report, [...path, k]);
    return;
  }
  const extra = Object.keys(v).filter((k) => !['$ref', '$step', 'field'].includes(k));
  if ('$ref' in v && '$step' in v) report(path, 'a reference has `$ref` or `$step`, not both');
  else if (extra.length)
    report(path, `a reference takes only \`field\` besides (got ${extra.join(', ')})`);
  if (v.field !== undefined && (typeof v.field !== 'string' || !v.field))
    report([...path, 'field'], '`field` is a key or a path like "ids/0"');
  if ('$ref' in v) {
    if (typeof v.$ref !== 'string' || !names.has(v.$ref))
      report(
        [...path, '$ref'],
        `no earlier step is named \`${String(v.$ref)}\` (names: ${[...names.keys()].join(', ') || 'none'})`,
      );
  } else if (!Number.isInteger(v.$step) || (v.$step as number) < 0 || (v.$step as number) >= at) {
    report([...path, '$step'], '`$step` must be the zero-based index of an earlier step');
  }
}
