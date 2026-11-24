/**
 * FigCraft arm: Claude drives a headless `figcraft-cli mcp` session through a manual tool-use
 * loop (same request shape as packages/agent/src/interactive.ts: adaptive thinking, medium
 * effort, automatic conversation cache breakpoint, cached prefix).
 *
 * Scope is enforced like the HTML memory host: an edit that touches layers outside a scoped
 * ("ask agent") request is undone and reported to the model as an error.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { SUGGEST_JOB_TOOL, suggestJobInput, type ModelGateway } from '@crunch/agent';
import {
  assistantText,
  checkExpect,
  metering,
  type ArmMetrics,
  type GoldenCase,
} from '../common';
import { isMutating } from './catalog';
import { buildLanding, TOKENS, type Fixture } from './fixture';
import { startFigcraft, type FigcraftSession, type ToolResult } from './mcp';
import { RENDER_TOOL, systemFor, toolsFor } from './prompt';
import { renderPng } from './render';
import { diff, explicitIds, snapshot, type Snapshot } from './snapshot';
import { CURATED_COMMANDS, type Variant } from './variants';

/** Sublayers that exist only because the HTML side's Button is a component instance. */
const HTML_ALIAS: Record<string, string> = {
  n_herocta001_label: 'n_herocta001',
  n_navcta0001_label: 'n_navcta0001',
};

const MAX_RESULT_CHARS = 40_000;

export interface FigcraftRun {
  metrics: ArmMetrics;
  png: Buffer;
  transcript: unknown;
  figcraftFile?: string;
}

interface Step {
  command: string;
  params?: Record<string, unknown>;
  as?: string;
}

class Turn {
  touched = new Set<number>();
  transactions = 0;
  commands: Step[] = [];
  jobSuggestion: string | null = null;
  toolCalls = 0;
  notes: string[] = [];
  constructor(
    readonly fc: FigcraftSession,
    readonly fx: Fixture,
    readonly variant: Variant,
    /** Fixture layer id the request is scoped to (ask-agent), if any. */
    readonly scopeId: number | null,
  ) {}

  /** Is figcraft layer `id` inside layer `root` in either snapshot? */
  inside(id: number, root: number, snaps: Snapshot[]) {
    let cur: number | null = id;
    const seen = new Set<number>();
    while (cur !== null && !seen.has(cur)) {
      if (cur === root) return true;
      seen.add(cur);
      const l = snaps.map((s) => s.get(cur!)).find(Boolean);
      cur = l?.parentId ?? null;
    }
    return false;
  }

  async mutate(steps: Step[], run: () => Promise<ToolResult>): Promise<ToolResult> {
    const before = await snapshot(this.fc, this.fx.rootId);
    const r = await run();
    if (r.isError) return r;
    const after = await snapshot(this.fc, this.fx.rootId);
    const d = diff(before, after);
    const ids = new Set([
      ...d.changed,
      ...d.created,
      ...d.deleted,
      ...steps.flatMap((s) => explicitIds(s.params)).filter((id) => before.has(id) || after.has(id)),
    ]);
    if (this.scopeId !== null) {
      const outside = [...ids].filter((id) => !this.inside(id, this.scopeId!, [after, before]));
      if (outside.length) {
        await this.fc.json('undo', {});
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Edit undone: it changed layers outside the scope (layer ${this.scopeId}): ${outside.join(', ')}. Only edit the scoped layer and its descendants.`,
            },
          ],
        };
      }
    }
    if (!ids.size) this.notes.push('a mutating call changed nothing');
    for (const id of ids) this.touched.add(id);
    this.transactions++;
    this.commands.push(...steps);
    if (this.variant.render === 'auto') {
      const png = await renderPng(this.fc, this.scopeId ?? this.fx.rootId, { maxSize: 1600 });
      r.content.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' });
    }
    return r;
  }

  async execute(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    this.toolCalls++;
    const v = this.variant;
    switch (name) {
      case 'batch': {
        const steps = (input.commands ?? []) as Step[];
        if (v.tools === 'run_command') return err('Unknown tool batch');
        if (v.tools === 'curated') {
          const bad = steps.filter(
            (s) => !(CURATED_COMMANDS as readonly string[]).includes(s.command),
          );
          if (bad.length)
            return err(
              `Not allowed here: ${bad.map((s) => s.command).join(', ')}. Allowed: ${CURATED_COMMANDS.join(', ')}`,
            );
        }
        if (!steps.some((s) => isMutating(s.command)))
          return this.fc.call('batch', input);
        return this.mutate(steps, () => this.fc.call('batch', input));
      }
      case 'run_command': {
        const step = { command: String(input.command), params: input.params as never };
        if (!isMutating(step.command)) return this.fc.call('run_command', input);
        if (v.tools === 'batch')
          return err('run_command is for read-only commands here. Make edits with batch.');
        return this.mutate([step], () => this.fc.call('run_command', input));
      }
      case 'get_node':
      case 'list_commands':
        return this.fc.call(name, input);
      case RENDER_TOOL: {
        const id = typeof input.id === 'number' ? input.id : (this.scopeId ?? this.fx.rootId);
        const scale = Math.min(Number(input.scale ?? 1) || 1, 2);
        const png = await renderPng(this.fc, id, { scale, maxSize: 1600 });
        return {
          content: [
            { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
            { type: 'text', text: `Rendered layer ${id} at scale ${scale}.` },
          ],
        };
      }
      case SUGGEST_JOB_TOOL: {
        const p = suggestJobInput.safeParse(input);
        if (!p.success) return err(`Invalid input: ${p.error.issues[0]?.message ?? 'invalid'}`);
        this.jobSuggestion = p.data.kind;
        return {
          content: [
            {
              type: 'text',
              text: 'Shown to the user as an offer to start a background job. Do not make edits for this request now.',
            },
          ],
        };
      }
      default:
        return err(`Unknown tool ${name}`);
    }
  }
}

const err = (text: string): ToolResult => ({ isError: true, content: [{ type: 'text', text }] });

function toToolResult(id: string, r: ToolResult): Anthropic.ToolResultBlockParam {
  const content: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = [];
  for (const c of r.content) {
    if (c.type === 'image' && c.data)
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: c.data },
      });
    else if (c.type === 'text') {
      const t = c.text ?? '';
      content.push({
        type: 'text',
        text:
          t.length > MAX_RESULT_CHARS
            ? `${t.slice(0, MAX_RESULT_CHARS)}\n…(truncated; ask for less with fields/depth)`
            : t || '(empty)',
      });
    }
  }
  if (!content.length) content.push({ type: 'text', text: '(no output)' });
  return { type: 'tool_result', tool_use_id: id, content, is_error: r.isError || undefined };
}

/** Per-turn document context (mirrors buildTurnContext): scope subtree, or outline + selection. */
async function turnContext(
  fc: FigcraftSession,
  fx: Fixture,
  c: GoldenCase,
  v: Variant,
): Promise<string> {
  const parts: string[] = [];
  const fig = (htmlId: string) => fx.ids[htmlId];
  if (c.scopeNodeId) {
    const id = fig(c.scopeNodeId)!;
    const snap = await snapshot(fc, fx.rootId);
    const crumbs: string[] = [];
    for (let cur = snap.get(id); cur; cur = cur.parentId ? snap.get(cur.parentId) : undefined)
      crumbs.unshift(`${cur.name} (${cur.id})`);
    parts.push(`Scope: only edit layer ${id} (${c.scopeNodeId}) and its descendants.`);
    parts.push(`Location: ${crumbs.join(' › ')}`);
    parts.push(`<subtree>\n${JSON.stringify(await fc.json('get_node', { id, depth: 8 }))}\n</subtree>`);
  } else {
    const outline = await fc.json('get_node', {
      id: fx.rootId,
      depth: 8,
      fields: ['name', 'type', 'width', 'height', 'characters'],
    });
    parts.push(`<outline>\n${JSON.stringify(outline)}\n</outline>`);
    const sel = (c.selection ?? []).map(fig).filter((x): x is number => typeof x === 'number');
    if (sel.length) {
      parts.push(`Selected: ${sel.map((id, i) => `${id} (${c.selection![i]})`).join(', ')}`);
      if (v.context === 'subtree')
        for (const id of sel)
          parts.push(
            `<subtree root="${id}">\n${JSON.stringify(await fc.json('get_node', { id, depth: 8 }))}\n</subtree>`,
          );
    } else parts.push('Nothing is selected. Use get_node to read the layers you need before editing.');
  }
  return `<document>\n${parts.join('\n')}\n</document>`;
}

/** Off-token values on touched layers: the FigCraft stand-in for `lintClean` (no ds-lint here). */
function offToken(snap: Snapshot, ids: number[], name: (id: number) => string): string[] {
  const colors = new Set([...Object.values(TOKENS), '#F97316'].map((c) => c.toUpperCase()));
  const space = new Set([0, 4, 8, 12, 16, 24, 32, 48, 64, 96]);
  const radius = new Set([0, 4, 8, 16, 9999]);
  const sizes = new Set([12, 14, 16, 18, 20, 24, 36, 60]);
  const out: string[] = [];
  for (const id of ids) {
    const l = snap.get(id);
    if (!l) continue;
    const p = l.props as Record<string, unknown>;
    const paints = [...((p.fills as unknown[]) ?? []), ...((p.strokes as unknown[]) ?? [])];
    for (const paint of paints as { type?: string; color?: string }[])
      if (paint.type === 'solid' && paint.color && !colors.has(paint.color.slice(0, 7).toUpperCase()))
        out.push(`color ${paint.color}@${name(id)}`);
    if (typeof p.fontSize === 'number' && !sizes.has(p.fontSize))
      out.push(`fontSize ${p.fontSize}@${name(id)}`);
    if (typeof p.cornerRadius === 'number' && !radius.has(p.cornerRadius))
      out.push(`radius ${p.cornerRadius}@${name(id)}`);
    const layout = p.layout as { mode?: string; gap?: number; padding?: number[] } | undefined;
    if (layout?.mode && layout.mode !== 'none') {
      for (const n of [layout.gap ?? 0, ...(layout.padding ?? [])])
        if (!space.has(n)) out.push(`space ${n}@${name(id)}`);
    }
  }
  return out;
}

export async function runFigcraftCase(
  c: GoldenCase,
  o: {
    gateway: ModelGateway;
    model: string;
    route: string;
    variant: Variant;
    /** Save the final document here (.figcraft). */
    saveTo?: string;
    /** Called with the fixture ids before the turn (scripted runs build their script from them). */
    onFixture?: (fx: Fixture) => void;
  },
): Promise<FigcraftRun> {
  const fc = await startFigcraft(
    o.saveTo ? { writeRoot: o.saveTo.replace(/\/[^/]+$/, '') } : {},
  );
  try {
    const fx = await buildLanding(fc);
    o.onFixture?.(fx);
    const nameOf = new Map(Object.entries(fx.ids).map(([n, id]) => [id, n]));
    const htmlId = (id: number) => {
      const n = nameOf.get(id);
      return n ? (HTML_ALIAS[n] ?? n) : `new:${id}`;
    };
    const scopeId = c.scopeNodeId ? fx.ids[c.scopeNodeId]! : null;
    const sel = c.scopeNodeId ? [scopeId!] : (c.selection ?? []).map((s) => fx.ids[s]!);
    if (sel.length) await fc.json('select', { ids: sel });
    const initial = await snapshot(fc, fx.rootId);

    const turn = new Turn(fc, fx, o.variant, scopeId);
    const system = systemFor(o.variant);
    const tools = toolsFor(o.variant);
    const userTurn: Anthropic.MessageParam = {
      role: 'user',
      content: [
        { type: 'text', text: await turnContext(fc, fx, c, o.variant) },
        { type: 'text', text: c.prompt },
      ],
    };
    const meter = metering(o.gateway, o.model);
    const turns: Anthropic.MessageParam[] = [];
    const maxIterations = c.expect.maxIterations ?? 10;
    let stopReason: string | null = null;
    const failures: string[] = [];
    const t0 = performance.now();
    try {
      for (let i = 0; i < maxIterations; i++) {
        const m = await meter.wrapped(
          {
            model: o.model,
            max_tokens: 16_000,
            system,
            tools,
            messages: [userTurn, ...turns],
            cache_control: { type: 'ephemeral' },
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium' },
          },
          {},
        );
        stopReason = m.stop_reason;
        turns.push({ role: 'assistant', content: m.content as Anthropic.ContentBlockParam[] });
        const uses = m.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        if (m.stop_reason === 'pause_turn') continue;
        if (!uses.length || m.stop_reason !== 'tool_use') break;
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const u of uses)
          results.push(toToolResult(u.id, await turn.execute(u.name, u.input as never)));
        turns.push({ role: 'user', content: results });
        if (i === maxIterations - 1) stopReason = 'max_iterations';
      }
    } catch (e) {
      failures.push(`turn failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    const wallMs = Math.round(performance.now() - t0);

    const final = await snapshot(fc, fx.rootId);
    const touchedFig = [...turn.touched];
    const touched = [...new Set(touchedFig.map(htmlId))];
    const usage = meter.usage();
    failures.push(
      ...checkExpect({
        expect: c.expect,
        touched,
        within: (id, root) => {
          const rootFig = fx.ids[root];
          if (rootFig === undefined) return false;
          const figIds = id.startsWith('new:')
            ? [Number(id.slice(4))]
            : touchedFig.filter((f) => htmlId(f) === id);
          return figIds.every((f) => turn.inside(f, rootFig, [final, initial]));
        },
        transactions: turn.transactions,
        jobSuggestion: turn.jobSuggestion,
        usage,
        lint: offToken(final, touchedFig, htmlId),
      }),
    );
    const png = await renderPng(fc, fx.rootId);
    if (o.saveTo) await fc.json('save_file', { path: o.saveTo });
    const metrics: ArmMetrics = {
      arm: 'figcraft',
      variant: o.variant.name,
      caseId: c.id,
      model: o.model,
      route: o.route,
      passed: failures.length === 0,
      failures,
      touched,
      transactions: turn.transactions,
      turns: meter.calls(),
      toolCalls: turn.toolCalls,
      jobSuggestion: turn.jobSuggestion,
      stopReason,
      usage,
      wallMs,
      finalText: assistantText(turns),
      commands: turn.commands,
      ...(turn.notes.length ? { notes: turn.notes } : {}),
    };
    return {
      metrics,
      png,
      transcript: { variant: o.variant, system, tools: tools.map((t) => t.name), userTurn, turns },
      ...(o.saveTo ? { figcraftFile: o.saveTo } : {}),
    };
  } finally {
    await fc.close();
  }
}

