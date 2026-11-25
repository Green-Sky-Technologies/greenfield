'use client';

/**
 * Fill and stroke lists (and stroke weight and position), and effects. A swatch opens the shared
 * colour picker (`openColourPicker`), whose drag is one gesture.
 */
import type { NodeFields, NodeId, PreviewCommand } from '@greenfield/editor-state';
import { useGesture } from '@greenfield/editor-state/react';
import { useContext, useState } from 'react';
import { openColourPicker, type ColourValue } from '@/features/pickers/open';
import { useClaudeChanges } from './agent-changes';
import {
  ClaudeNote,
  cmd,
  errorText,
  IconButton,
  NumberField,
  ReportContext,
  Row,
  Section,
  SelectField,
  useApply,
} from './controls';
import {
  EFFECT_NAMES,
  effects,
  MIXED,
  paints,
  parseHex,
  round,
  shared,
  type Paint,
} from './fields';
import { Eye, EyeOff, Minus, Plus } from './icons';

interface Props {
  ids: readonly NodeId[];
  nodes: readonly NodeFields[];
}

type Kind = 'fills' | 'strokes';

const rgba = (c: unknown) => {
  if (typeof c === 'string') return c;
  const o = (c ?? {}) as { r?: number; g?: number; b?: number; a?: number };
  const ch = (v = 0) => Math.round(v * 255);
  return `rgba(${ch(o.r)}, ${ch(o.g)}, ${ch(o.b)}, ${o.a ?? 1})`;
};

/** What a swatch shows: the colour, or the gradient's stops. */
function swatch(p: Paint): string {
  if (p.type === 'solid') return p.color ?? 'transparent';
  const stops = Array.isArray(p.stops) ? (p.stops as { color: unknown }[]) : [];
  return stops.length
    ? `linear-gradient(90deg, ${stops.map((s) => rgba(s.color)).join(', ')})`
    : 'transparent';
}

const paintName = (p: Paint) =>
  p.type === 'solid'
    ? (p.color ?? '')
    : p.type === 'gradient'
      ? `${String(p.kind ?? 'linear').replace(/^./, (c) => c.toUpperCase())} gradient`
      : p.type.replace(/^./, (c) => c.toUpperCase());

function PaintRow({
  kind,
  ids,
  index,
  paint,
  changed,
}: {
  kind: Kind;
  ids: readonly NodeId[];
  index: number;
  paint: Paint;
  changed: boolean;
}) {
  const apply = useApply();
  const report = useContext(ReportContext);
  const noun = kind === 'fills' ? 'fill' : 'stroke';
  const gesture = useGesture(`Change ${noun} colour`);
  const [hex, setHex] = useState<string | null>(null);
  const set = (params: Record<string, unknown>): PreviewCommand =>
    kind === 'fills'
      ? cmd('fill.set', { ids: [...ids], index, ...params })
      : cmd('stroke.set', { ids: [...ids], index, ...params });
  const solid = paint.type === 'solid';
  const visible = paint.visible !== false;
  const opacity = Math.round((paint.opacity ?? 1) * 100);
  const n = index + 1;

  const colour = (v: ColourValue): Record<string, unknown> =>
    'hex' in v
      ? { color: v.hex, opacity: v.opacity }
      : 'variable' in v
        ? { color: { $var: v.variable } }
        : {};
  const pick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const ended = (p: Promise<void>) =>
      p.then(
        () => report(null),
        (err: unknown) => report(errorText(err)),
      );
    openColourPicker(
      { x: r.left, y: r.bottom },
      {
        value: { hex: paint.color ?? '#000000', opacity: paint.opacity ?? 1 },
        onPreview: (v) => {
          if (!('style' in v)) gesture.preview([set(colour(v))]);
        },
        onCommit: (v) => {
          if ('style' in v) {
            void gesture.cancel();
            apply(
              [cmd('style.apply', { ids: [...ids], style: v.style, target: noun })],
              `Apply ${noun} style`,
            );
            return;
          }
          gesture.preview([set(colour(v))]);
          ended(gesture.commit());
        },
        onCancel: () => ended(gesture.cancel()),
      },
    );
  };

  const commitHex = () => {
    if (hex === null) return;
    setHex(null);
    const parsed = parseHex(hex);
    if (!parsed) return report(`"${hex}" is not a hex colour`);
    if (parsed !== paint.color?.toUpperCase())
      apply([set({ color: parsed })], `Change ${noun} colour`);
  };

  return (
    <div
      className={`flex h-7 items-center gap-2 bg-surface-2 pl-2 font-mono text-xs ${
        changed ? 'shadow-[inset_2px_0_0_var(--ember)]' : ''
      } ${visible ? '' : 'opacity-50'}`}
      data-testid={`${noun}-row`}
      data-changed={changed || undefined}
    >
      <button
        type="button"
        aria-label={`${noun[0]!.toUpperCase()}${noun.slice(1)} ${n} colour`}
        onClick={pick}
        className="shell-focus size-3.5 shrink-0 shadow-[inset_0_0_0_1px_var(--rule)]"
        style={{ background: swatch(paint), opacity: solid ? (paint.opacity ?? 1) : 1 }}
        data-testid={`${noun}-swatch`}
      />
      {solid ? (
        <input
          aria-label={`${noun[0]!.toUpperCase()}${noun.slice(1)} ${n} hex`}
          data-testid={`${noun}-hex`}
          className="w-full min-w-0 bg-transparent text-text uppercase outline-none"
          value={hex ?? (paint.color ?? '').replace(/^#/, '')}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setHex(e.currentTarget.value)}
          onBlur={commitHex}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitHex();
            if (e.key === 'Escape') setHex(null);
          }}
        />
      ) : (
        <span className="w-full min-w-0 truncate text-text">{paintName(paint)}</span>
      )}
      <div className="w-16 shrink-0">
        <NumberField
          label="%"
          name={`${noun[0]!.toUpperCase()}${noun.slice(1)} ${n} opacity`}
          value={opacity}
          set={(v) => [set({ opacity: round(Number(v) / 100) })]}
          undo={`Change ${noun} opacity`}
          min={0}
          max={100}
          testId={`${noun}-opacity`}
        />
      </div>
      <IconButton
        label={`${visible ? 'Hide' : 'Show'} ${noun} ${n}`}
        onClick={() => apply([set({ visible: !visible })], `${visible ? 'Hide' : 'Show'} ${noun}`)}
      >
        {visible ? <Eye /> : <EyeOff />}
      </IconButton>
      <IconButton
        label={`Remove ${noun} ${n}`}
        onClick={() =>
          apply(
            [
              kind === 'fills'
                ? cmd('fill.remove', { ids: [...ids], index })
                : cmd('stroke.remove', { ids: [...ids], index }),
            ],
            `Remove ${noun}`,
          )
        }
      >
        <Minus />
      </IconButton>
    </div>
  );
}

const STROKE_ALIGN = [
  ['inside', 'Inside'],
  ['center', 'Center'],
  ['outside', 'Outside'],
] as const;

/** The fill list, or the stroke list with weight and position. */
export function PaintsSection({ ids, nodes, kind }: Props & { kind: Kind }) {
  const apply = useApply();
  const fields = kind === 'fills' ? ['fills'] : ['strokes', 'strokeWeight', 'strokeAlign'];
  const { changes, keys, at } = useClaudeChanges(nodes, fields);
  const list = shared(nodes, (n) => paints(n, kind));
  const noun = kind === 'fills' ? 'fill' : 'stroke';
  const title = kind === 'fills' ? 'Fill' : 'Stroke';
  const add = () =>
    apply(
      [
        kind === 'fills'
          ? cmd('fill.add', { ids: [...ids] })
          : cmd('stroke.add', { ids: [...ids] }),
      ],
      `Add ${noun}`,
    );
  // The editor lists paints bottom first; the panel shows the top one first.
  const rows = list === MIXED ? [] : list.map((p, i) => [p, i] as const).reverse();
  return (
    <Section
      title={title}
      testId={`section-${kind}`}
      actions={
        <IconButton label={`Add ${noun}`} onClick={add}>
          <Plus />
        </IconButton>
      }
    >
      {list === MIXED ? (
        <p className="text-xs text-muted">Mixed {kind}. Add one to replace them.</p>
      ) : (
        rows.map(([p, i]) => (
          <PaintRow key={i} kind={kind} ids={ids} index={i} paint={p} changed={keys.has(kind)} />
        ))
      )}
      {kind === 'strokes' && list !== MIXED && list.length > 0 && (
        <Row>
          <NumberField
            label="Wt"
            name="Stroke weight"
            value={shared(nodes, (n) => n.strokeWeight ?? 1)}
            set={(v) => [cmd('node.set', { ids: [...ids], strokeWeight: Number(v) })]}
            undo="Change stroke weight"
            min={0}
            changed={keys.has('strokeWeight')}
            testId="design-stroke-weight"
          />
          <SelectField
            name="Stroke position"
            value={shared(nodes, (n) => (n.strokeAlign as 'inside') ?? 'inside')}
            options={STROKE_ALIGN}
            onChange={(v) =>
              apply([cmd('node.set', { ids: [...ids], strokeAlign: v })], 'Change stroke position')
            }
            changed={keys.has('strokeAlign')}
          />
        </Row>
      )}
      <ClaudeNote what={title} changes={changes} at={at} />
    </Section>
  );
}

const EFFECT_TYPES = ['dropShadow', 'innerShadow', 'layerBlur', 'backgroundBlur'] as const;

export function EffectsSection({ ids, nodes }: Props) {
  const apply = useApply();
  const { changes, keys, at } = useClaudeChanges(nodes, ['effects']);
  const list = shared(nodes, effects);
  return (
    <Section
      title="Effects"
      testId="section-effects"
      actions={
        <IconButton
          label="Add effect"
          onClick={() =>
            apply([cmd('effect.add', { ids: [...ids], type: 'dropShadow' })], 'Add effect')
          }
        >
          <Plus />
        </IconButton>
      }
    >
      {list === MIXED ? (
        <p className="text-xs text-muted">Mixed effects</p>
      ) : !list.length ? (
        <p className="text-xs text-muted">None</p>
      ) : (
        list.map((e, index) => {
          const visible = e.visible !== false;
          const n = index + 1;
          const setEffect = (effect: Record<string, unknown>) =>
            cmd('effect.set', { ids: [...ids], index, effect: { ...e, ...effect } });
          return (
            <div
              key={index}
              data-testid="effect-row"
              className={`flex items-center gap-2 ${visible ? '' : 'opacity-50'}`}
            >
              <div className="min-w-0 flex-1">
                <SelectField
                  name={`Effect ${n} type`}
                  value={e.type}
                  options={EFFECT_TYPES.map((t) => [t, EFFECT_NAMES[t]!] as const)}
                  onChange={(type) => apply([setEffect({ type })], 'Change effect')}
                  changed={keys.has('effects')}
                />
              </div>
              <div className="w-16 shrink-0">
                <NumberField
                  label="R"
                  name={`Effect ${n} radius`}
                  value={e.radius ?? 0}
                  set={(v) => [setEffect({ radius: Number(v) })]}
                  undo="Change effect"
                  min={0}
                  testId="effect-radius"
                />
              </div>
              <IconButton
                label={`${visible ? 'Hide' : 'Show'} effect ${n}`}
                onClick={() => apply([setEffect({ visible: !visible })], 'Change effect')}
              >
                {visible ? <Eye /> : <EyeOff />}
              </IconButton>
              <IconButton
                label={`Remove effect ${n}`}
                onClick={() =>
                  apply([cmd('effect.remove', { ids: [...ids], index })], 'Remove effect')
                }
              >
                <Minus />
              </IconButton>
            </div>
          );
        })
      )}
      <ClaudeNote what="Effects" changes={changes} at={at} />
    </Section>
  );
}
