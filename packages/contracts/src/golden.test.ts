/**
 * Story 1.4 AC: a fake executor runs the golden prompts' tool calls against the mock bridge.
 *
 * For each case in `evals/golden/interactive.json`, a scripted sequence of the calls a good agent
 * would make (read the selection or a layer, one `run_batch`, `render`; or offer a job) runs
 * through `executeTool` against a `MockEditor` seeded with the `landing` fixture. Every input and
 * output is checked against the contract, and the case's scope expectations against the change
 * set the mock ends up with. Model quality is Story 4.8's job; this checks the contract and the
 * checks themselves.
 */
import { diffSnapshots, flatten, type NodeId, type NodeRecord } from '@greenfield/bridge';
import { MockEditor } from '@greenfield/bridge/mock';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS, executeTool, type AgentToolName, type ToolInput } from './index';
import {
  buildLanding,
  checkScope,
  goldenCases,
  LANDING_TOKENS,
  type GoldenCase,
  type LandingFixture,
} from './testing';

const CASES = goldenCases.parse(
  JSON.parse(
    readFileSync(new URL('../../../evals/golden/interactive.json', import.meta.url), 'utf8'),
  ),
);

/** A button's label is part of the button (the HTML fixture's Button was one node). */
const ALIAS: Record<string, string> = {
  n_herocta001_label: 'n_herocta001',
  n_navcta0001_label: 'n_navcta0001',
};

type Call = { [N in AgentToolName]: { name: N; input: ToolInput<N> } }[AgentToolName];
const call = <N extends AgentToolName>(name: N, input: ToolInput<N>) => ({ name, input }) as Call;

/** What a good agent sends for each case. */
const SCRIPTS: Record<string, (fx: LandingFixture) => Call[]> = {
  'button-larger-scoped': ({ ids }) => [
    call('get_selection', { depth: 1 }),
    call('run_batch', {
      label: 'Make the button larger',
      commands: [
        {
          command: 'node.set',
          params: { id: ids.n_herocta001, props: { padding: [12, 24, 12, 24] } },
        },
        { command: 'node.set', params: { id: ids.n_herocta001_label, props: { fontSize: 16 } } },
      ],
    }),
    call('render', { ids: [ids.n_herocta001!] }),
  ],
  'headline-copy': ({ ids }) => [
    call('get_selection', { fields: ['name', 'characters'] }),
    call('run_batch', {
      label: 'Change the headline',
      commands: [
        {
          command: 'text.set',
          params: { id: ids.n_herotitle1, characters: 'Design at the speed of thought' },
        },
      ],
    }),
    call('render', { ids: [ids.n_hero000001!], scale: 0.5 }),
  ],
  'feature-cards-spacing': ({ ids }) => [
    call('get_node', { id: ids.n_features01!, depth: 1, fields: ['name', 'layout'] }),
    call('run_batch', {
      label: 'Tighten feature spacing',
      commands: [
        { command: 'node.set', params: { id: ids.n_features01, props: { gap: 12 } } },
        {
          command: 'node.set',
          params: {
            ids: [ids.n_feat1card00, ids.n_feat2card00, ids.n_feat3card00],
            props: { padding: 16, gap: 4 },
          },
        },
      ],
    }),
    call('render', { ids: [ids.n_features01!], scale: 0.5 }),
  ],
  'density-slider': ({ ids }) => [
    call('get_node', { id: ids.n_features01!, depth: 2 }),
    call('list_commands', { query: 'layout' }),
    call('run_batch', {
      label: 'Add a density control',
      commands: [
        {
          command: 'node.create',
          as: 'control',
          params: {
            type: 'frame',
            parent: ids.n_features01,
            index: 0,
            name: 'Density',
            select: false,
            props: {
              layout: 'horizontal',
              gap: 4,
              padding: 4,
              cornerRadius: 8,
              fill: LANDING_TOKENS.surface,
              sizingH: 'hug',
              sizingV: 'hug',
            },
          },
        },
        ...['Compact', 'Comfortable', 'Spacious'].map((label, i) => ({
          command: 'node.create',
          params: {
            type: 'text',
            parent: { $ref: 'control' },
            name: label,
            text: label,
            select: false,
            props: {
              fontFamily: 'SF Pro',
              fontStyle: i === 1 ? 'Semibold' : 'Regular',
              fontSize: 14,
              fill: i === 1 ? LANDING_TOKENS.text : LANDING_TOKENS.muted,
            },
          },
        })),
      ],
    }),
    call('render', { ids: [ids.n_features01!] }),
  ],
  'pricing-page-offers-job': () => [
    call('get_outline', { depth: 2 }),
    call('suggest_generation_job', {
      kind: 'generate',
      prompt:
        'A pricing page in the style of the landing page: three tiers (Free, Pro, Team) as equal-height cards with a CTA each, then an FAQ.',
      reason: 'A new page is a background job.',
    }),
  ],
  'alternatives-offers-job': ({ rootId }) => [
    call('get_outline', {}),
    call('suggest_generation_job', {
      kind: 'alternatives',
      prompt: 'The landing page with completely different layouts, same content and tokens.',
      frameIds: [String(rootId)],
      count: 3,
      reason: 'Several alternatives run as a background job.',
    }),
  ],
};

interface Replay {
  touched: string[];
  edits: number;
  jobSuggestion: string | null;
  within(name: string, root: string): boolean;
  undo: string[];
  labels: string[];
  calls: number;
  /** run_batch calls refused (and undone) for leaving the scope. */
  scopeErrors: number;
}

async function replay(c: GoldenCase, opts = { enforceScope: true }): Promise<Replay> {
  const editor = new MockEditor();
  const fx = await buildLanding(editor);
  const selection = c.scopeNodeId ? [c.scopeNodeId] : (c.selection ?? []);
  const scope = selection.map((n) => fx.ids[n]!);
  await editor.execute('select.set', { ids: scope });
  const page = async () => {
    const doc = await editor.inspect({ depth: 64 });
    return flatten(doc.pages.find((p) => p.id === doc.currentPage));
  };
  const initial = await page();

  const touched = new Set<NodeId>();
  const labels: string[] = [];
  let jobSuggestion: string | null = null;
  let scopeErrors = 0;
  const script = SCRIPTS[c.id]!(fx);
  for (const { name, input } of script) {
    const def = AGENT_TOOLS[name];
    // The call the model sends fits the contract...
    expect(def.input.safeParse(input).success, `${c.id}: ${name} input`).toBe(true);
    // As on the interactive path, the selection is the scope (Story 4.2).
    const r = await executeTool(name, input, editor, {
      scope: opts.enforceScope && scope.length ? scope : null,
    });
    if (!r.ok && r.error.kind === 'scope') {
      scopeErrors++;
      continue;
    }
    if (!r.ok) throw new Error(`${c.id}: ${name} failed: ${r.error.message}`);
    // ...and so does what comes back.
    if (r.output !== undefined)
      expect(def.output.safeParse(r.output).success, `${c.id}: ${name} output`).toBe(true);
    expect(r.content.length).toBeGreaterThan(0);
    for (const id of r.touched) touched.add(id);
    if (name === 'run_batch') labels.push(input.label);
    if (r.control?.tool === 'suggest_generation_job') jobSuggestion = r.control.input.kind;
  }

  const final = await page();
  // The executor's touched set covers every layer that actually changed.
  const d = diffSnapshots(initial, final);
  for (const id of [...d.added, ...d.removed, ...d.changed.map((x) => x.id)]) {
    expect(touched.has(id), `${c.id}: change to ${id} not reported`).toBe(true);
  }

  const nameOf = (id: NodeId) => {
    const n = fx.names.get(id);
    return n ? (ALIAS[n] ?? n) : `new:${id}`;
  };
  const idsOf = (name: string): NodeId[] =>
    name.startsWith('new:')
      ? [Number(name.slice(4))]
      : [...touched].filter((id) => nameOf(id) === name);
  const inside = (id: NodeId, root: NodeId, snaps: Map<NodeId, NodeRecord>[]) => {
    for (let cur: NodeId | null = id, hops = 0; cur !== null && hops < 100; hops++) {
      if (cur === root) return true;
      const at: NodeId = cur;
      cur = (snaps.map((s) => s.get(at)).find(Boolean)?.parent as NodeId | null) ?? null;
    }
    return false;
  };
  return {
    touched: [...new Set([...touched].map(nameOf))].sort(),
    edits: labels.length,
    jobSuggestion,
    within: (name, root) =>
      fx.ids[root] !== undefined &&
      idsOf(name).every((id) => inside(id, fx.ids[root]!, [final, initial])),
    undo: (await editor.inspect({ depth: 0 })).history.undo,
    labels,
    calls: script.length,
    scopeErrors,
  };
}

describe('golden prompts replayed against the mock bridge', () => {
  it('has a script for every golden case', () => {
    expect(Object.keys(SCRIPTS).sort()).toEqual(CASES.map((c) => c.id).sort());
  });

  for (const c of CASES) {
    it(`${c.id}: calls and results fit the contract; scope expectations hold`, async () => {
      const r = await replay(c);
      expect(checkScope(c.expect, r)).toEqual([]);
      // Each run_batch is exactly one undo step, labelled as sent.
      expect(r.undo).toEqual([...r.labels].reverse().concat('Landing fixture'));
      // One model turn per call plus the final reply.
      if (c.expect.maxIterations !== undefined)
        expect(r.calls + 1).toBeLessThanOrEqual(c.expect.maxIterations);
    });
  }

  it('the checks catch an agent that strays out of scope', async () => {
    const c = CASES.find((x) => x.id === 'button-larger-scoped')!;
    const original = SCRIPTS[c.id]!;
    SCRIPTS[c.id] = (fx) => [
      ...original(fx),
      call('run_batch', {
        label: 'Also the nav',
        commands: [
          { command: 'node.set', params: { id: fx.ids.n_navcta0001, props: { padding: 12 } } },
        ],
      }),
    ];
    try {
      // Without enforcement the checks see the stray edit...
      const r = await replay(c, { enforceScope: false });
      expect(checkScope(c.expect, r)).toEqual([
        'touched outside n_herocta001: n_navcta0001',
        'touched 2 layers (max 1)',
      ]);
      // ...and with it (the interactive path), the stray batch is undone and reported.
      const enforced = await replay(c);
      expect(enforced.scopeErrors).toBe(1);
      expect(checkScope(c.expect, enforced)).toEqual([]);
      expect(enforced.undo).toEqual(['Make the button larger', 'Landing fixture']);
    } finally {
      SCRIPTS[c.id] = original;
    }
  });

  it('the checks catch edits on a job hand-off case, and a missing offer', async () => {
    const c = CASES.find((x) => x.id === 'pricing-page-offers-job')!;
    const original = SCRIPTS[c.id]!;
    SCRIPTS[c.id] = (fx) => [
      call('run_batch', {
        label: 'Start a pricing page',
        commands: [
          { command: 'node.create', params: { type: 'frame', parent: fx.rootId, name: 'Pricing' } },
        ],
      }),
    ];
    try {
      const r = await replay(c);
      expect(checkScope(c.expect, r)).toEqual([
        `expected no edits, got 1 edit(s) touching ${r.touched.join(', ')}`,
        'job suggestion: expected generate, got null',
      ]);
    } finally {
      SCRIPTS[c.id] = original;
    }
  });
});
