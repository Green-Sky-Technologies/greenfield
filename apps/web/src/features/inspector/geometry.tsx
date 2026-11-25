'use client';

/**
 * Position, size and constraints; auto layout and resizing; opacity, blend and radius.
 */
import type { NodeFields, NodeId } from '@greenfield/editor-state';
import { useClaudeChanges } from './agent-changes';
import {
  ClaudeNote,
  cmd,
  IconButton,
  NumberField,
  Row,
  Section,
  Segmented,
  SelectField,
  useApply,
} from './controls';
import {
  blend,
  constraint,
  isFrame,
  isText,
  layout,
  MIXED,
  opacity,
  radius,
  shared,
  sizing,
  type Sizing,
} from './fields';
import { Minus, Plus } from './icons';

interface Props {
  ids: readonly NodeId[];
  nodes: readonly NodeFields[];
}

const H_CONSTRAINTS = [
  ['left', 'Left'],
  ['right', 'Right'],
  ['leftRight', 'Left & right'],
  ['center', 'Center'],
  ['scale', 'Scale'],
] as const;
const V_CONSTRAINTS = [
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['topBottom', 'Top & bottom'],
  ['center', 'Center'],
  ['scale', 'Scale'],
] as const;

export function PositionSection({ ids, nodes, nested }: Props & { nested: boolean }) {
  const apply = useApply();
  const { changes, keys, at } = useClaudeChanges(nodes, [
    'x',
    'y',
    'width',
    'height',
    'rotation',
    'constraints',
  ]);
  const num = (k: 'x' | 'y' | 'width' | 'height' | 'rotation', label: string, name: string) => (
    <NumberField
      label={label}
      name={name}
      value={shared(nodes, (n) => n[k] ?? (k === 'rotation' ? 0 : undefined))}
      set={(v) => [cmd('node.set', { ids: [...ids], [k]: Number(v) })]}
      undo={`Change ${name.toLowerCase()}`}
      min={k === 'width' || k === 'height' ? 0.01 : undefined}
      changed={keys.has(k)}
      testId={`design-${k}`}
    />
  );
  const setConstraint = (axis: 'horizontal' | 'vertical', v: string) =>
    apply(
      nodes.map((n) =>
        cmd('node.set', {
          id: n.id,
          props: {
            constraints: {
              horizontal: axis === 'horizontal' ? v : constraint(n, 'horizontal'),
              vertical: axis === 'vertical' ? v : constraint(n, 'vertical'),
            },
          },
        }),
      ),
      'Change constraints',
    );
  return (
    <Section title="Position" testId="section-position">
      <Row>
        {num('x', 'X', 'X position')}
        {num('y', 'Y', 'Y position')}
        {num('width', 'W', 'Width')}
        {num('height', 'H', 'Height')}
        {num('rotation', '°', 'Rotation')}
      </Row>
      {nested && (
        <Row>
          <SelectField
            label="↔"
            name="Horizontal constraint"
            value={shared(nodes, (n) => constraint(n, 'horizontal'))}
            options={H_CONSTRAINTS}
            onChange={(v) => setConstraint('horizontal', v)}
            changed={keys.has('constraints.horizontal')}
          />
          <SelectField
            label="↕"
            name="Vertical constraint"
            value={shared(nodes, (n) => constraint(n, 'vertical'))}
            options={V_CONSTRAINTS}
            onChange={(v) => setConstraint('vertical', v)}
            changed={keys.has('constraints.vertical')}
          />
        </Row>
      )}
      <ClaudeNote what="Position" changes={changes} at={at} />
    </Section>
  );
}

const SIZING = [
  ['fixed', 'Fixed'],
  ['hug', 'Hug'],
  ['fill', 'Fill'],
] as const;
const MAIN_ALIGN = [
  ['min', 'Start'],
  ['center', 'Center'],
  ['max', 'End'],
  ['spaceBetween', 'Space between'],
] as const;
const CROSS_ALIGN = [
  ['min', 'Start'],
  ['center', 'Center'],
  ['max', 'End'],
  ['baseline', 'Baseline'],
] as const;

/** Auto layout (frames) and resizing (Hug / Fixed / Fill). */
export function LayoutSection({ ids, nodes }: Props) {
  const apply = useApply();
  const { changes, keys, at } = useClaudeChanges(nodes, ['layout', 'sizing']);
  const frames = nodes.every(isFrame);
  const sized = nodes.some((n) => n.sizing !== undefined);
  if (!frames && !sized) return null;
  const lay = shared(nodes, layout);
  const on = lay !== MIXED && lay !== null;
  const each = (read: (l: NonNullable<ReturnType<typeof layout>>) => unknown) =>
    shared(nodes, (n) => {
      const l = layout(n);
      return l ? read(l) : undefined;
    });
  const setAll = (props: Record<string, unknown>, label: string) =>
    apply([cmd('node.set', { ids: [...ids], ...props })], label);
  const setSizing = (axis: 'sizingH' | 'sizingV', v: Sizing) =>
    setAll({ [axis]: v }, 'Change resizing');
  const padding = (sides: [number, number]) =>
    shared(nodes, (n) => {
      const p = layout(n)?.padding;
      if (!p) return undefined;
      return p[sides[0]] === p[sides[1]] ? p[sides[0]] : MIXED;
    });

  return (
    <Section
      title={frames ? 'Auto layout' : 'Resizing'}
      testId="section-layout"
      actions={
        frames &&
        (lay === null ? (
          <IconButton
            label="Add auto layout"
            onClick={() => setAll({ layout: 'vertical' }, 'Add auto layout')}
          >
            <Plus />
          </IconButton>
        ) : (
          <IconButton
            label="Remove auto layout"
            onClick={() => setAll({ layout: null }, 'Remove auto layout')}
          >
            <Minus />
          </IconButton>
        ))
      }
    >
      {frames && on && (
        <>
          <Row>
            <Segmented
              name="Direction"
              value={each((l) => l.mode) as 'horizontal' | 'vertical' | typeof MIXED}
              options={[
                ['vertical', 'Vertical', '↓'],
                ['horizontal', 'Horizontal', '→'],
              ]}
              onChange={(v) => setAll({ layout: v }, 'Change direction')}
              changed={keys.has('layout.mode')}
            />
            <NumberField
              label="Gap"
              name="Gap"
              value={each((l) => l.gap)}
              set={(v) => [cmd('node.set', { ids: [...ids], gap: Number(v) })]}
              undo="Change gap"
              min={0}
              changed={keys.has('layout.gap')}
              testId="design-gap"
            />
            <NumberField
              label="H"
              name="Horizontal padding"
              value={padding([1, 3])}
              set={(v) => [
                cmd('node.set', { ids: [...ids], paddingLeft: Number(v), paddingRight: Number(v) }),
              ]}
              undo="Change padding"
              min={0}
              changed={keys.has('layout.padding')}
              testId="design-padding-h"
            />
            <NumberField
              label="V"
              name="Vertical padding"
              value={padding([0, 2])}
              set={(v) => [
                cmd('node.set', { ids: [...ids], paddingTop: Number(v), paddingBottom: Number(v) }),
              ]}
              undo="Change padding"
              min={0}
              changed={keys.has('layout.padding')}
              testId="design-padding-v"
            />
            <SelectField
              label="Main"
              name="Main axis alignment"
              value={each((l) => l.mainAlign) as string}
              options={MAIN_ALIGN}
              onChange={(v) => setAll({ mainAlign: v }, 'Change alignment')}
              changed={keys.has('layout.mainAlign')}
            />
            <SelectField
              label="Cross"
              name="Cross axis alignment"
              value={each((l) => l.crossAlign) as string}
              options={CROSS_ALIGN}
              onChange={(v) => setAll({ crossAlign: v }, 'Change alignment')}
              changed={keys.has('layout.crossAlign')}
            />
          </Row>
          {each((l) => l.mode) === 'horizontal' && (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                className="accent-[var(--field)]"
                checked={each((l) => l.wrap) === true}
                onChange={(e) => setAll({ wrap: e.currentTarget.checked }, 'Change wrap')}
              />
              Wrap
            </label>
          )}
        </>
      )}
      {sized && (
        <Row>
          <SelectField
            label="W"
            name="Horizontal resizing"
            value={shared(nodes, (n) => sizing(n, 'horizontal'))}
            options={SIZING}
            onChange={(v) => setSizing('sizingH', v)}
            changed={keys.has('sizing.horizontal')}
            testId="design-sizing-h"
          />
          <SelectField
            label="H"
            name="Vertical resizing"
            value={shared(nodes, (n) => sizing(n, 'vertical'))}
            options={SIZING}
            onChange={(v) => setSizing('sizingV', v)}
            changed={keys.has('sizing.vertical')}
            testId="design-sizing-v"
          />
        </Row>
      )}
      <ClaudeNote what="Layout" changes={changes} at={at} />
    </Section>
  );
}

const BLENDS = [
  ['normal', 'Normal'],
  ['darken', 'Darken'],
  ['multiply', 'Multiply'],
  ['colorBurn', 'Color burn'],
  ['lighten', 'Lighten'],
  ['screen', 'Screen'],
  ['colorDodge', 'Color dodge'],
  ['overlay', 'Overlay'],
  ['softLight', 'Soft light'],
  ['hardLight', 'Hard light'],
  ['difference', 'Difference'],
  ['exclusion', 'Exclusion'],
  ['hue', 'Hue'],
  ['saturation', 'Saturation'],
  ['color', 'Color'],
  ['luminosity', 'Luminosity'],
] as const;

/** Opacity, blend and corner radius. */
export function LayerSection({ ids, nodes }: Props) {
  const apply = useApply();
  const { changes, keys, at } = useClaudeChanges(nodes, ['opacity', 'blend', 'cornerRadius']);
  const o = shared(nodes, opacity);
  const rounded = !nodes.some((n) => isText(n) || n.type === 'LINE' || n.type === 'GROUP');
  return (
    <Section title="Layer" testId="section-layer">
      <Row>
        <NumberField
          label="%"
          name="Layer opacity"
          value={o === MIXED ? MIXED : Math.round(o * 100)}
          set={(v) => [cmd('node.set', { ids: [...ids], opacity: Number(v) / 100 })]}
          undo="Change opacity"
          min={0}
          max={100}
          changed={keys.has('opacity')}
          testId="design-opacity"
        />
        <SelectField
          name="Blend mode"
          value={shared(nodes, blend)}
          options={BLENDS}
          onChange={(v) => apply([cmd('node.set', { ids: [...ids], blend: v })], 'Change blend')}
          changed={keys.has('blend')}
          testId="design-blend"
        />
        {rounded && (
          <NumberField
            label="R"
            name="Corner radius"
            value={shared(nodes, radius)}
            set={(v) => [cmd('node.set', { ids: [...ids], cornerRadius: Number(v) })]}
            undo="Change radius"
            min={0}
            changed={keys.has('cornerRadius')}
            testId="design-radius"
          />
        )}
      </Row>
      <ClaudeNote what="Layer" changes={changes} at={at} />
    </Section>
  );
}
