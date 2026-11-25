'use client';

/**
 * Components, variables and styles in the Design tab (Story 5.9): an instance's properties and
 * variants, the styles applied to the selection (apply, detach), the variables bound to its
 * fields (bind, unbind) and the variable modes of a frame; then its export settings (5.11).
 * Reads the store's selected layers; the file's variables and styles are read when the
 * selection's bindings change (`useLibrary`).
 */
import type { NodeFields } from '@greenfield/editor-state';
import { useEditorState, useSelection } from '@greenfield/editor-state/react';
import { useState } from 'react';
import { displayName, useLibrary, type Library } from '@/features/pickers/library';
import { ExportSection } from './export-section';
import { InstanceSection } from './instance-properties';
import {
  bindableFields,
  common,
  fieldLabel,
  isContainer,
  MIXED,
  SLOT_TYPE,
  styleSlots,
  type StyleSlot,
} from './model';
import { IconButton, Row, Section, Select, UNLINK, useRun } from './ui';

const SLOT_LABEL: Record<StyleSlot, string> = {
  text: 'Text',
  fill: 'Fill',
  stroke: 'Stroke',
  effect: 'Effect',
  grid: 'Layout grid',
};

export function StylesSection() {
  const selection = useSelection();
  const all = useEditorState((s) => s.nodes);
  const nodes = selection.flatMap((id) => {
    const n = all.get(id);
    return n ? [n] : [];
  });
  const document = useEditorState((s) => s.document?.id ?? null);
  const library = useLibrary(
    JSON.stringify([document, nodes.map((n) => [n.id, n.styles, n.boundVariables])]),
  );
  if (!nodes.length) return null;
  return (
    <div data-testid="styles-section">
      {nodes.length === 1 && nodes[0]!.type === 'INSTANCE' && <InstanceSection node={nodes[0]!} />}
      <AppliedStyles nodes={nodes} library={library} />
      <Variables nodes={nodes} library={library} />
      {nodes.every(isContainer) && <VariableModes nodes={nodes} library={library} />}
      {nodes.length === 1 && <ExportSection node={nodes[0]!} />}
    </div>
  );
}

function AppliedStyles({ nodes, library }: { nodes: NodeFields[]; library: Library }) {
  const { run, error } = useRun();
  const ids = nodes.map((n) => n.id);
  const slots = styleSlots(nodes[0]!).filter((s) => nodes.every((n) => styleSlots(n).includes(s)));
  return (
    <Section title="Styles">
      {slots.map((slot) => {
        const applied = common(nodes, (n) => (n.styles as Record<string, unknown>)?.[slot] ?? null);
        const options = library.styles.filter((s) => s.type === SLOT_TYPE[slot]);
        const name =
          applied === MIXED ? null : (library.styles.find((s) => s.id === applied)?.name ?? null);
        return (
          <Row key={slot} label={SLOT_LABEL[slot]}>
            <Select
              aria-label={`${SLOT_LABEL[slot]} style`}
              value={applied === MIXED ? '\0mixed' : ((applied as string | null) ?? '')}
              onChange={(e) =>
                run('style.apply', {
                  ids,
                  style: e.target.value,
                  ...(slot === 'fill' || slot === 'stroke' ? { target: slot } : {}),
                })
              }
            >
              {applied === MIXED && <option value={'\0mixed'}>Mixed</option>}
              {applied === null && (
                <option value="">{options.length ? 'None' : 'No styles'}</option>
              )}
              {applied !== null && applied !== MIXED && !name && (
                <option value={applied as string}>Unknown style</option>
              )}
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {displayName(s.name)}
                </option>
              ))}
            </Select>
            {applied !== null && (
              <IconButton
                label={`Detach ${SLOT_LABEL[slot].toLowerCase()} style`}
                onClick={() => run('style.detach', { ids, which: slot })}
              >
                {UNLINK}
              </IconButton>
            )}
          </Row>
        );
      })}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </Section>
  );
}

function Variables({ nodes, library }: { nodes: NodeFields[]; library: Library }) {
  const { run, error } = useRun();
  const ids = nodes.map((n) => n.id);
  const fields = bindableFields(nodes[0]!).filter((f) =>
    nodes.every((n) => bindableFields(n).some((g) => g.field === f.field)),
  );
  const bound = common(nodes, (n) => (n.boundVariables ?? {}) as Record<string, string>);
  const [field, setField] = useState('');
  const picked = fields.find((f) => f.field === field);
  const candidates = picked ? library.variables.filter((v) => v.type === picked.type) : [];
  return (
    <Section title="Variables">
      {bound === MIXED ? (
        <p className="text-xs text-muted">Mixed bindings</p>
      ) : (
        Object.entries(bound).map(([f, id]) => (
          <Row key={f} label={fieldLabel(f, fields)}>
            <span
              className="min-w-0 flex-1 truncate bg-surface-2 px-2 py-1.5"
              data-testid="bound-variable"
            >
              {displayName(library.variables.find((v) => v.id === id)?.name ?? id)}
            </span>
            <IconButton
              label={`Unbind ${fieldLabel(f, fields).toLowerCase()}`}
              onClick={() => run('variable.bind', { ids, field: f, variable: null })}
            >
              {UNLINK}
            </IconButton>
          </Row>
        ))
      )}
      <Row label="Bind">
        <Select aria-label="Field to bind" value={field} onChange={(e) => setField(e.target.value)}>
          <option value="">Field…</option>
          {fields.map((f) => (
            <option key={f.field} value={f.field}>
              {f.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Variable"
          value=""
          disabled={!picked}
          onChange={(e) => {
            run('variable.bind', { ids, field, variable: e.target.value });
            setField('');
          }}
        >
          <option value="">{picked && !candidates.length ? 'No variables' : 'Variable…'}</option>
          {candidates.map((v) => (
            <option key={v.id} value={v.id}>
              {displayName(v.name)}
            </option>
          ))}
        </Select>
      </Row>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </Section>
  );
}

/**
 * A frame's mode per collection (`variable.setMode`). The editor doesn't report a layer's modes,
 * so each control shows what was set from here for this selection, else "Set mode…".
 */
function VariableModes({ nodes, library }: { nodes: NodeFields[]; library: Library }) {
  const { run, error } = useRun();
  const ids = nodes.map((n) => n.id);
  const [chosen, setChosen] = useState<{ key: string; modes: Record<string, string> }>({
    key: '',
    modes: {},
  });
  const key = ids.join(',');
  const modes = chosen.key === key ? chosen.modes : {};
  const collections = library.collections.filter((c) => c.modes.length > 1);
  if (!collections.length) return null;
  return (
    <Section title="Variable modes">
      {collections.map((c) => (
        <Row key={c.id} label={c.name}>
          <Select
            aria-label={`${c.name} mode`}
            value={modes[c.id] ?? ''}
            onChange={(e) => {
              const mode = e.target.value;
              setChosen({ key, modes: { ...modes, [c.id]: mode } });
              run('variable.setMode', {
                ids,
                collection: c.id,
                mode: mode === 'auto' ? null : mode,
              });
            }}
          >
            {!modes[c.id] && <option value="">Set mode…</option>}
            <option value="auto">Auto (inherit)</option>
            {c.modes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Row>
      ))}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </Section>
  );
}
