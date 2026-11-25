'use client';

/**
 * The Prototype tab (Story 5.12): the selected layer's interactions (trigger, action and
 * destination, animation, duration, easing) and the page's flow starting points, edited with
 * `proto.*`. Everything it shows comes from the store: the layer's `interactions` field and the
 * page's flows, both patched by `document.changed`.
 */
import type { CommandId, CommandParams, NodeId } from '@greenfield/bridge';
import {
  useEditorStore,
  useFlows,
  useNode,
  usePageTree,
  useSelection,
} from '@greenfield/editor-state/react';
import type { Flow, PageTree } from '@greenfield/editor-state';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  ACTIONS,
  DIRECTIONS,
  EASINGS,
  TRANSITIONS,
  TRIGGERS,
  actionPatch,
  hasDirection,
  interactionsOf,
  labelOf,
  needsDest,
  transitionPatch,
  triggerPatch,
  type Interaction,
} from './interactions';

/** Layer types a prototype can navigate to or start on: the page's top-level frames. */
const SCREEN_TYPES = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE']);

type Run = <C extends CommandId>(command: C, params: CommandParams<C>) => void;

/** `store.run`, with the editor's refusal shown in the tab instead of thrown. */
function useRun(): { run: Run; error: string | null } {
  const store = useEditorStore();
  const [error, setError] = useState<string | null>(null);
  const run = useCallback<Run>(
    (command, params) => {
      setError(null);
      store.run(command, params).catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
    },
    [store],
  );
  return { run, error };
}

/** The top-level layer `id` is in (itself when it's one). */
function screenOf(tree: PageTree, id: NodeId): NodeId | null {
  let n = tree.nodes.get(id);
  while (n && n.parent !== tree.page) n = tree.nodes.get(n.parent);
  return n?.id ?? null;
}

export function PrototypeTab() {
  const selection = useSelection();
  const id = selection.length === 1 ? selection[0] : undefined;
  const node = useNode(id);
  const tree = usePageTree();
  const { run, error } = useRun();
  const screens = useMemo(
    () => tree.roots.filter((r) => SCREEN_TYPES.has(tree.nodes.get(r)?.type ?? '')),
    [tree],
  );

  return (
    <section aria-label="Prototype" data-testid="prototype-tab" className="text-xs">
      <div className="border-b border-border px-4 py-3.5 text-[13px] font-semibold">
        {selection.length === 0
          ? 'Nothing selected'
          : selection.length > 1
            ? `${selection.length} layers`
            : (node?.name ?? '…')}
      </div>
      {id != null && node && (
        <Interactions id={id} interactions={interactionsOf(node)} screens={screens} run={run} />
      )}
      {selection.length > 1 && (
        <p className="border-b border-border px-4 py-3.5 text-muted">
          Select one layer to edit its interactions.
        </p>
      )}
      <Flows screens={screens} selected={id} run={run} />
      {error && (
        <p role="alert" className="px-4 py-3 text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 border-b border-border px-4 py-3.5">
      <h3 className="type-label text-muted">{title}</h3>
      {children}
    </div>
  );
}

function Interactions({
  id,
  interactions,
  screens,
  run,
}: {
  id: NodeId;
  interactions: Interaction[];
  screens: readonly NodeId[];
  run: Run;
}) {
  const tree = usePageTree();
  const add = () => {
    const own = screenOf(tree, id);
    const dest = screens.find((s) => s !== own) ?? screens[0];
    run(
      'proto.interaction.add',
      dest == null ? { id, action: { type: 'back' } } : { id, action: { type: 'navigate', dest } },
    );
  };
  return (
    <Section title="Interactions">
      {interactions.length === 0 && <p className="text-muted">No interactions.</p>}
      {interactions.map((interaction, index) => (
        <InteractionCard
          key={index}
          id={id}
          index={index}
          interaction={interaction}
          screens={screens}
          run={run}
        />
      ))}
      <button
        type="button"
        onClick={add}
        className="shell-focus self-start text-muted hover:text-text"
      >
        + Add interaction
      </button>
    </Section>
  );
}

function InteractionCard({
  id,
  index,
  interaction: i,
  screens,
  run,
}: {
  id: NodeId;
  index: number;
  interaction: Interaction;
  screens: readonly NodeId[];
  run: Run;
}) {
  const tree = usePageTree();
  const set = (patch: Omit<CommandParams<'proto.interaction.set'>, 'id' | 'index'>) =>
    run('proto.interaction.set', { id, index, ...patch });
  const action = i.actions[0];
  const actionType = action?.type ?? '';
  const name = (s: NodeId) => tree.nodes.get(s)?.name ?? `Layer ${s}`;
  const n = index + 1;

  return (
    <div
      role="group"
      aria-label={`Interaction ${n}`}
      className="flex flex-col gap-1.5 bg-surface-2 p-2.5"
    >
      <Row label="Trigger">
        <Choice
          label={`Interaction ${n} trigger`}
          value={i.trigger.type}
          options={TRIGGERS}
          onChange={(t) => set(triggerPatch(t))}
        />
      </Row>
      {i.trigger.type === 'afterDelay' && (
        <Row label="Delay">
          <Millis
            label={`Interaction ${n} delay`}
            value={i.trigger.ms ?? 0}
            onCommit={(ms) => set({ trigger: { type: 'afterDelay', ms } })}
          />
        </Row>
      )}
      <Row label="Action">
        <Choice
          label={`Interaction ${n} action`}
          value={actionType}
          options={Object.fromEntries(
            Object.entries(ACTIONS)
              .filter(([type, a]) => !a.dest || screens.length > 0 || type === actionType)
              .map(([type, a]) => [type, a.label]),
          )}
          onChange={(t) => {
            const patch = actionPatch(action, t, screens);
            if (patch) set(patch);
          }}
        />
      </Row>
      {needsDest(actionType) && (
        <Row label="Destination">
          <Choice
            label={`Interaction ${n} destination`}
            value={action?.dest == null ? '' : String(action.dest)}
            options={Object.fromEntries(screens.map((s) => [String(s), name(s)]))}
            onChange={(dest) => set({ action: { type: actionType, dest: Number(dest) } })}
            accent
          />
        </Row>
      )}
      {actionType === 'openUrl' && (
        <Row label="Link">
          <TextField
            label={`Interaction ${n} link`}
            value={action?.url ?? ''}
            placeholder="https://"
            onCommit={(url) => set({ action: { type: 'openUrl', url } })}
            className="w-36"
          />
        </Row>
      )}
      <Row label="Animation">
        <Choice
          label={`Interaction ${n} animation`}
          value={i.transition.type}
          options={TRANSITIONS}
          onChange={(t) => set(transitionPatch(i.transition, t))}
        />
      </Row>
      {hasDirection(i.transition) && (
        <Row label="Direction">
          <Choice
            label={`Interaction ${n} direction`}
            value={i.transition.direction ?? 'left'}
            options={DIRECTIONS}
            onChange={(direction) => set({ transition: { ...i.transition, direction } })}
          />
        </Row>
      )}
      {i.transition.type !== 'instant' && (
        <>
          <Row label="Duration">
            <Millis
              label={`Interaction ${n} duration`}
              value={i.duration_ms}
              onCommit={(durationMs) => set({ durationMs })}
            />
          </Row>
          <Row label="Easing">
            <Choice
              label={`Interaction ${n} easing`}
              value={typeof i.easing === 'string' ? i.easing : 'custom'}
              options={typeof i.easing === 'string' ? EASINGS : { ...EASINGS, custom: 'Custom' }}
              onChange={(easing) => set({ easing })}
            />
          </Row>
        </>
      )}
      <button
        type="button"
        aria-label={`Remove interaction ${n}`}
        onClick={() => run('proto.interaction.remove', { id, index })}
        className="shell-focus self-end text-muted hover:text-text"
      >
        Remove
      </button>
    </div>
  );
}

function Flows({
  screens,
  selected,
  run,
}: {
  screens: readonly NodeId[];
  selected: NodeId | undefined;
  run: Run;
}) {
  const flows = useFlows();
  const canStart =
    selected != null && screens.includes(selected) && !flows.some((f) => f.start === selected);
  return (
    <Section title="Flow starting points">
      {flows.length === 0 && !canStart && (
        <p className="text-muted">Select a top-level frame to start a flow there.</p>
      )}
      <ul aria-label="Flows" className="flex flex-col gap-2">
        {flows.map((f) => (
          <FlowRow key={f.start} flow={f} run={run} />
        ))}
      </ul>
      {canStart && (
        <button
          type="button"
          onClick={() => run('proto.flow.add', { start: selected })}
          className="shell-focus self-start text-muted hover:text-text"
        >
          + Add starting point
        </button>
      )}
    </Section>
  );
}

function FlowRow({ flow, run }: { flow: Flow; run: Run }) {
  const tree = usePageTree();
  const start = tree.nodes.get(flow.start)?.name ?? `Layer ${flow.start}`;
  return (
    <li className="flex items-center gap-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <TextField
          label={`Flow name ${flow.name}`}
          value={flow.name}
          onCommit={(name) => {
            if (!name) return false;
            run('proto.flow.rename', { start: flow.start, name });
          }}
          className="text-left"
        />
        <span className="truncate text-muted">Starts at {start}</span>
      </div>
      <button
        type="button"
        aria-label={`Remove flow ${flow.name}`}
        onClick={() => run('proto.flow.remove', { start: flow.start })}
        className="shell-focus px-1 text-muted hover:text-text"
      >
        ×
      </button>
    </li>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-muted">{label}</span>
      {children}
    </div>
  );
}

const control =
  'shell-focus min-w-0 bg-transparent text-right outline-none focus-visible:outline-2 focus-visible:outline-user';

function Choice({
  label,
  value,
  options,
  onChange,
  accent,
}: {
  label: string;
  value: string;
  options: Record<string, string>;
  onChange: (value: string) => void;
  accent?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${control} ${accent ? 'text-user' : 'text-text'}`}
    >
      {!(value in options) && <option value={value}>{labelOf(options, value)}</option>}
      {Object.entries(options).map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );
}

/**
 * A field that sends its value on Enter or blur, and goes back to the store's value on Escape or
 * when `onCommit` refuses it (returns false).
 */
function TextField({
  label,
  value,
  placeholder,
  onCommit,
  className,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (value: string) => boolean | void;
  className: string;
}) {
  return (
    <input
      key={value}
      aria-label={label}
      defaultValue={value}
      placeholder={placeholder}
      onBlur={(e) => {
        const input = e.currentTarget;
        const next = input.value.trim();
        if (next !== value && onCommit(next) === false) input.value = value;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') e.currentTarget.value = value;
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
      }}
      className={`${control} ${className}`}
    />
  );
}

function Millis({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (ms: number) => void;
}) {
  return (
    <span className="flex items-center gap-1 font-mono">
      <TextField
        label={label}
        value={String(value)}
        onCommit={(text) => {
          const ms = Math.round(Number(text));
          if (text === '' || !Number.isFinite(ms) || ms < 0) return false;
          onCommit(ms);
        }}
        className="w-14"
      />
      <span className="text-muted">ms</span>
    </span>
  );
}
