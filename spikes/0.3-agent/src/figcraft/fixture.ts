/**
 * The `landing` fixture (packages/doc-model sampleLandingDoc + starterDesignSystem), rebuilt in
 * FigCraft with one `batch`. Every layer is named after its HTML node id (`n_herocta001`), so
 * golden-case scopes and selections map 1:1; names are what the agent and the checks use.
 *
 * Tokens are resolved to literal values at desktop (lg) width, rem = 16px:
 *   color.*  -> hex, space.N -> N*4px, radius.md 8, radius.lg 16, text.sm 14, text.lg 18,
 *   text.6xl 60 (hero h1 at lg), weight -> font style, leading.tight 115%, leading.normal 150%.
 */
import type { FigcraftSession } from './mcp';

export const TOKENS = {
  background: '#FFFFFF',
  surface: '#F6F6F4',
  text: '#18181B',
  muted: '#6B6B70',
  border: '#E4E4E7',
  primary: '#4F46E5',
  primaryText: '#FFFFFF',
} as const;

export const FONT = process.env.SPIKE_FONT ?? 'SF Pro';

type Step = { command: string; as?: string; params: Record<string, unknown> };

const ref = (as: string) => ({ $ref: as });

function text(
  as: string,
  parent: string,
  characters: string,
  props: Record<string, unknown>,
): Step {
  return {
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
  };
}

function frame(
  as: string,
  parent: string | null,
  props: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Step {
  return {
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
  };
}

/** Buttons are plain auto-layout frames (the HTML side uses a Button component instance). */
function button(as: string, parent: string, label: string, variant: 'primary' | 'secondary') {
  const primary = variant === 'primary';
  return [
    frame(as, parent, {
      layout: 'horizontal',
      mainAlign: 'center',
      crossAlign: 'center',
      gap: 8,
      padding: [8, 16, 8, 16],
      cornerRadius: 8,
      sizingH: 'hug',
      sizingV: 'hug',
      ...(primary ? { fill: TOKENS.primary } : { stroke: TOKENS.border, strokeWeight: 1 }),
    }),
    text(`${as}_label`, as, label, {
      fontSize: 14,
      fontStyle: 'Semibold',
      fill: primary ? TOKENS.primaryText : TOKENS.text,
    }),
  ];
}

function feature(i: number, title: string, body: string): Step[] {
  const card = `n_feat${i}card00`;
  return [
    frame(card, 'n_features01', {
      layout: 'vertical',
      gap: 8,
      padding: 24,
      cornerRadius: 16,
      fill: TOKENS.surface,
      sizingH: 'fill',
      sizingV: 'hug',
    }),
    text(`n_feat${i}title0`, card, title, {
      fontSize: 18,
      fontStyle: 'Semibold',
      fill: TOKENS.text,
    }),
    text(`n_feat${i}body00`, card, body, {
      fontSize: 14,
      lineHeight: '150%',
      fill: TOKENS.muted,
      textAutoResize: 'height',
      sizingH: 'fill',
    }),
  ];
}

export function landingSteps(): Step[] {
  return [
    frame(
      'n_root000001',
      null,
      {
        layout: 'vertical',
        fill: TOKENS.background,
        sizingV: 'hug',
        clip: true,
      },
      { x: 0, y: 0, width: 1280, height: 800 },
    ),
    // Nav: space-between row, 16/24 padding, bottom border.
    frame('n_nav0000001', 'n_root000001', {
      layout: 'horizontal',
      mainAlign: 'spaceBetween',
      crossAlign: 'center',
      padding: [16, 24, 16, 24],
      sizingH: 'fill',
      sizingV: 'hug',
      stroke: TOKENS.border,
      strokeSides: [false, false, true, false],
      strokeWeight: 1,
    }),
    text('n_logo000001', 'n_nav0000001', 'Acme', {
      fontSize: 18,
      fontStyle: 'Bold',
      fill: TOKENS.text,
    }),
    ...button('n_navcta0001', 'n_nav0000001', 'Sign up', 'secondary'),
    // Hero: column, start-aligned, gap 24, padding 96/24 (lg).
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
      fill: TOKENS.text,
      maxWidth: 800, // 20ch at 60px (measured in Chromium)
    }),
    text(
      'n_herobody01',
      'n_hero000001',
      'Describe what you want. Refine it on a live canvas. Export real code.',
      { fontSize: 18, fill: TOKENS.muted, maxWidth: 560 /* 48ch at 18px */ },
    ),
    ...button('n_herocta001', 'n_hero000001', 'Get started', 'primary'),
    // Features: 3-column grid, gap 16, padding 0/24/64/24.
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

export interface Fixture {
  /** HTML node id (= FigCraft layer name) -> FigCraft layer id. */
  ids: Record<string, number>;
  rootId: number;
}

export async function buildLanding(fc: FigcraftSession): Promise<Fixture> {
  const steps = landingSteps();
  const results = await fc.json<unknown[]>('batch', { label: 'Landing fixture', commands: steps });
  const ids: Record<string, number> = {};
  steps.forEach((s, i) => {
    const r = results[i] as { id?: number } | undefined;
    if (s.as && typeof r?.id === 'number') ids[s.as] = r.id;
  });
  // A fresh untitled session starts with nothing selected; keep it that way.
  await fc.json('select', { ids: [] });
  return { ids, rootId: ids.n_root000001! };
}
