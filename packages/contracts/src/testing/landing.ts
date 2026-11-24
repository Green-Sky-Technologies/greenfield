/**
 * The `landing` golden fixture, built with one batch (from `spikes/0.3-agent/src/figcraft/
 * fixture.ts`). Every layer is named after its HTML node id (`n_herocta001`), so golden-case
 * scopes and selections map 1:1. Tokens are resolved to literal values at desktop width.
 */
import { ref, type BatchStep, type Editor, type NodeId } from '@greenfield/bridge';

export const LANDING_TOKENS = {
  background: '#FFFFFF',
  surface: '#F6F6F4',
  text: '#18181B',
  muted: '#6B6B70',
  border: '#E4E4E7',
  primary: '#4F46E5',
  primaryText: '#FFFFFF',
} as const;

const FONT = 'SF Pro';
const T = LANDING_TOKENS;

const text = (as: string, parent: string, characters: string, props: object): BatchStep => ({
  command: 'node.create',
  as,
  params: {
    type: 'text',
    parent: ref(parent),
    name: as,
    text: characters,
    select: false,
    props: { fontFamily: FONT, textAutoResize: 'widthAndHeight', ...props },
  },
});

const frame = (
  as: string,
  parent: string | null,
  props: object,
  extra: object = {},
): BatchStep => ({
  command: 'node.create',
  as,
  params: {
    type: 'frame',
    name: as,
    select: false,
    ...(parent ? { parent: ref(parent) } : {}),
    ...extra,
    props: { fill: 'none', ...props },
  },
});

/** Buttons are auto-layout frames with a text child (`<id>_label`). */
const button = (as: string, parent: string, label: string, primary: boolean): BatchStep[] => [
  frame(as, parent, {
    layout: 'horizontal',
    mainAlign: 'center',
    crossAlign: 'center',
    gap: 8,
    padding: [8, 16, 8, 16],
    cornerRadius: 8,
    sizingH: 'hug',
    sizingV: 'hug',
    ...(primary ? { fill: T.primary } : { stroke: T.border, strokeWeight: 1 }),
  }),
  text(`${as}_label`, as, label, {
    fontSize: 14,
    fontStyle: 'Semibold',
    fill: primary ? T.primaryText : T.text,
  }),
];

const feature = (i: number, title: string, body: string): BatchStep[] => {
  const card = `n_feat${i}card00`;
  return [
    frame(card, 'n_features01', {
      layout: 'vertical',
      gap: 8,
      padding: 24,
      cornerRadius: 16,
      fill: T.surface,
      sizingH: 'fill',
      sizingV: 'hug',
    }),
    text(`n_feat${i}title0`, card, title, { fontSize: 18, fontStyle: 'Semibold', fill: T.text }),
    text(`n_feat${i}body00`, card, body, {
      fontSize: 14,
      lineHeight: '150%',
      fill: T.muted,
      textAutoResize: 'height',
      sizingH: 'fill',
    }),
  ];
};

export function landingSteps(): BatchStep[] {
  return [
    frame(
      'n_root000001',
      null,
      { layout: 'vertical', fill: T.background, sizingV: 'hug', clip: true },
      { x: 0, y: 0, width: 1280, height: 800 },
    ),
    frame('n_nav0000001', 'n_root000001', {
      layout: 'horizontal',
      mainAlign: 'spaceBetween',
      crossAlign: 'center',
      padding: [16, 24, 16, 24],
      sizingH: 'fill',
      sizingV: 'hug',
      stroke: T.border,
      strokeWeight: 1,
    }),
    text('n_logo000001', 'n_nav0000001', 'Acme', { fontSize: 18, fontStyle: 'Bold', fill: T.text }),
    ...button('n_navcta0001', 'n_nav0000001', 'Sign up', false),
    frame('n_hero000001', 'n_root000001', {
      layout: 'vertical',
      crossAlign: 'min',
      gap: 24,
      padding: [96, 24, 96, 24],
      sizingH: 'fill',
      sizingV: 'hug',
    }),
    text('n_herotitle1', 'n_hero000001', 'Ship designs your engineers can build.', {
      fontSize: 60,
      fontStyle: 'Bold',
      lineHeight: '115%',
      fill: T.text,
      maxWidth: 800,
    }),
    text(
      'n_herobody01',
      'n_hero000001',
      'Describe what you want. Refine it on a live canvas. Export real code.',
      { fontSize: 18, fill: T.muted, maxWidth: 560 },
    ),
    ...button('n_herocta001', 'n_hero000001', 'Get started', true),
    frame('n_features01', 'n_root000001', {
      layout: 'grid',
      gridColumns: 3,
      columnTracks: ['1fr', '1fr', '1fr'],
      gap: 16,
      padding: [0, 24, 64, 24],
      sizingH: 'fill',
      sizingV: 'hug',
    }),
    ...feature(1, 'Live HTML frames', 'Every frame is real DOM, so what you see is what ships.'),
    ...feature(2, 'Your design system', 'Tokens and components keep every screen on brand.'),
    ...feature(3, 'Code handoff', 'Export React + Tailwind straight from the document.'),
  ];
}

export interface LandingFixture {
  /** HTML node id (= layer name) → layer id. */
  ids: Record<string, NodeId>;
  /** Layer id → HTML node id. */
  names: Map<NodeId, string>;
  rootId: NodeId;
}

/** Build the fixture in `editor` (one undo step) and clear the selection. */
export async function buildLanding(editor: Editor): Promise<LandingFixture> {
  const steps = landingSteps();
  const results = await editor.batch(steps, { label: 'Landing fixture' });
  const ids: Record<string, NodeId> = {};
  steps.forEach((s, i) => {
    const r = results[i] as { id?: unknown } | undefined;
    if (s.as && typeof r?.id === 'number') ids[s.as] = r.id;
  });
  await editor.execute('select.set', { ids: [] });
  return {
    ids,
    names: new Map(Object.entries(ids).map(([n, id]) => [id, n])),
    rootId: ids.n_root000001!,
  };
}
