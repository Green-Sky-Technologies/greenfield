'use client';

/**
 * Typography for selected text layers: family (the shared font picker), weight, size, line
 * height, letter spacing and alignment.
 */
import type { NodeFields, NodeId } from '@greenfield/editor-state';
import { openFontPicker } from '@/features/pickers/open';
import { useClaudeChanges } from './agent-changes';
import {
  ClaudeNote,
  cmd,
  NumberField,
  Row,
  Section,
  Segmented,
  SelectField,
  useApply,
} from './controls';
import { FONT_STYLES, MIXED, shared, styleWeight } from './fields';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from './icons';

interface Props {
  ids: readonly NodeId[];
  nodes: readonly NodeFields[];
}

const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);

export function TypographySection({ ids, nodes }: Props) {
  const apply = useApply();
  const { changes, keys, at } = useClaudeChanges(nodes, [
    'fontFamily',
    'fontStyle',
    'fontSize',
    'lineHeight',
    'letterSpacing',
    'textAlign',
  ]);
  const set = (props: Record<string, unknown>) => [cmd('node.set', { ids: [...ids], ...props })];
  const family = shared(nodes, (n) => str(n.fontFamily, ''));
  const style = shared(nodes, (n) => str(n.fontStyle, 'Regular'));
  const weights = FONT_STYLES.map((s) => [s, `${styleWeight(s)} ${s}`] as const);

  return (
    <Section title="Typography" testId="section-typography">
      <button
        type="button"
        aria-label="Font family"
        data-testid="design-font-family"
        data-changed={keys.has('fontFamily') || undefined}
        className={`shell-focus flex h-7 items-center bg-surface-2 px-2.5 text-left font-mono text-xs ${
          keys.has('fontFamily') ? 'shadow-[inset_2px_0_0_var(--ember)]' : ''
        } ${family === MIXED ? 'text-muted' : 'text-text'}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          openFontPicker(
            { x: r.left, y: r.bottom },
            {
              family: family === MIXED ? '' : family,
              onCommit: (f) => apply(set({ fontFamily: f }), 'Change font'),
              onCancel: () => {},
            },
          );
        }}
      >
        {family === MIXED ? 'Mixed' : family}
      </button>
      <Row>
        <SelectField
          label="Wt"
          name="Font weight"
          value={style}
          options={weights}
          onChange={(v) => apply(set({ fontStyle: v }), 'Change weight')}
          changed={keys.has('fontStyle')}
          testId="design-font-style"
        />
        <NumberField
          label="Sz"
          name="Font size"
          value={shared(nodes, (n) => n.fontSize)}
          set={(v) => set({ fontSize: Number(v) })}
          undo="Change font size"
          min={1}
          changed={keys.has('fontSize')}
          testId="design-font-size"
        />
        <NumberField
          label="Lh"
          name="Line height"
          value={shared(nodes, (n) => n.lineHeight ?? 'Auto')}
          set={(v) => set({ lineHeight: v })}
          undo="Change line height"
          measured
          min={0}
          from={{ value: 120, unit: '%' }}
          changed={keys.has('lineHeight')}
          testId="design-line-height"
        />
        <NumberField
          label="Ls"
          name="Letter spacing"
          value={shared(nodes, (n) => n.letterSpacing ?? '0%')}
          set={(v) => set({ letterSpacing: v })}
          undo="Change letter spacing"
          measured
          step={0.1}
          changed={keys.has('letterSpacing')}
          testId="design-letter-spacing"
        />
      </Row>
      <Segmented
        name="Text alignment"
        value={shared(nodes, (n) => str(n.textAlign, 'left'))}
        options={[
          ['left', 'Align left', <AlignLeft key="l" />],
          ['center', 'Align center', <AlignCenter key="c" />],
          ['right', 'Align right', <AlignRight key="r" />],
          ['justified', 'Justify', <AlignJustify key="j" />],
        ]}
        onChange={(v) => apply(set({ textAlign: v }), 'Change alignment')}
        changed={keys.has('textAlign')}
      />
      <ClaudeNote what="Typography" changes={changes} at={at} />
    </Section>
  );
}
