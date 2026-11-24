/**
 * Pluggable FigCraft-arm variants. A variant = system prompt x tool shape x render feedback x
 * context. Named presets below; any axis can be overridden from the CLI (the run's variant name
 * then spells the axes out).
 */
export type PromptVariant = 'base' | 'full-catalog' | 'minimal' | 'v2';
/**
 * batch:       batch + run_command (read-only) + get_node + list_commands + render + suggest job
 * run_command: one command per call (no batch) + get_node + list_commands + render + suggest job
 * curated:     batch restricted to CURATED_COMMANDS (no catalog discovery) + get_node + render + suggest job
 */
export type ToolShape = 'batch' | 'run_command' | 'curated';
/** tool: a render tool; auto: also attach a render of the scope after every edit; none: no pixels. */
export type RenderMode = 'tool' | 'auto' | 'none';
/** subtree: selection/scope subtree JSON (all fields) + page outline; outline: outline only. */
export type ContextMode = 'subtree' | 'outline';

export interface Variant {
  name: string;
  prompt: PromptVariant;
  tools: ToolShape;
  render: RenderMode;
  context: ContextMode;
}

export const PRESETS: Record<string, Omit<Variant, 'name'>> = {
  /** The starting point: SPEC §2.3 shape (subtree + outline, one batch, render to check). */
  v1: { prompt: 'base', tools: 'batch', render: 'tool', context: 'subtree' },
  'v1-auto-render': { prompt: 'base', tools: 'batch', render: 'auto', context: 'subtree' },
  'v1-no-render': { prompt: 'base', tools: 'batch', render: 'none', context: 'subtree' },
  'run-command': { prompt: 'base', tools: 'run_command', render: 'tool', context: 'subtree' },
  curated: { prompt: 'base', tools: 'curated', render: 'tool', context: 'subtree' },
  'full-catalog': { prompt: 'full-catalog', tools: 'batch', render: 'tool', context: 'subtree' },
  minimal: { prompt: 'minimal', tools: 'batch', render: 'tool', context: 'outline' },
  /** v1 + craft rules learned from v1's build-a-screen failures (font fallback, card rows). */
  v2: { prompt: 'v2', tools: 'batch', render: 'tool', context: 'subtree' },
};

/** Commands the `curated` shape allows and the base prompt documents. */
export const CURATED_COMMANDS = [
  'node.create',
  'node.set',
  'node.reparent',
  'node.reorder',
  'node.find',
  'node.get',
  'text.set',
  'text.style',
  'edit.duplicate',
  'edit.delete',
  'effect.add',
  'layout.setTrack',
] as const;

export function resolveVariant(
  name: string | undefined,
  overrides: Partial<Omit<Variant, 'name'>>,
): Variant {
  const base = PRESETS[name ?? 'v1'];
  if (!base) throw new Error(`Unknown variant ${name}; presets: ${Object.keys(PRESETS).join(', ')}`);
  const v = { ...base, ...overrides };
  const changed = Object.keys(overrides).length > 0;
  return {
    ...v,
    name: changed
      ? `${name ?? 'v1'}+p-${v.prompt}+t-${v.tools}+r-${v.render}+c-${v.context}`
      : (name ?? 'v1'),
  };
}
