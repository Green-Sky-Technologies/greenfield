'use client';

/* Throwaway spike: it keeps the drag in a ref and flips flags on the store from event handlers, which the React compiler's lint rules dislike. Story 5.6 builds the real store. */
/* eslint-disable react-hooks/immutability, react-hooks/set-state-in-effect */

/**
 * Story 5.0 canvas-mode spike (throwaway, dev builds only; see docs/adr/0005-canvas-mode.md).
 *
 * A page laid out like docs/brand/mockups/editor.png: our top bar, our layers list on the left,
 * our inspector on the right, and the FigCraft editor in canvas mode in the middle. Query:
 *   ?file=small|large|stress   the document (default small)
 *   ?sync=poll|pointer|events   how panels learn about canvas edits (default pointer)
 *   ?pollMs=100                 poll interval for sync=poll
 *   ?canvas=flag|toggle|off     how the editor is reduced to the canvas
 *   ?theme=light                the canvas follows the app (default dark)
 */
import { createBridge, type Editor } from '@greenfield/bridge';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Scrub } from './gesture';
import { afterPaint, perf, watchEditorFrames, watchEditorInput } from './perf';
import { SpikeStore, Syncer, type LayerRow, type SyncMode } from './store';

const ROW_H = 24;
const PALETTE = ['#3fd67f', '#ff9a4d', '#ece8de', '#1b733f', '#a54a0f', '#55534c'];

interface Handle {
  editor: Editor;
  iframe: HTMLIFrameElement;
  store: SpikeStore;
  syncer: Syncer;
  commands: Set<string>;
}

declare global {
  interface Window {
    __spike?: Handle & { loaded: Promise<{ nodes: number }> };
  }
}

function useSpikeState(store: SpikeStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

async function buildGenerated(editor: Editor, count: number) {
  await editor.batch(
    [
      {
        command: 'node.create',
        as: 'f',
        params: {
          type: 'frame',
          x: 0,
          y: 0,
          width: 1440,
          height: 900,
          name: 'Hero',
          props: { fills: ['#f3f0e8'] },
        },
      },
    ],
    { label: 'spike: frame' },
  );
  const per = 400;
  for (let start = 0; start < count; start += per) {
    const steps = [];
    for (let i = start; i < Math.min(count, start + per); i++) {
      const col = i % 40;
      const row = Math.floor(i / 40);
      steps.push({
        command: 'node.create' as const,
        params: {
          type: 'rectangle',
          parent: 2, // the frame above: layer ids start at 1 (the page), so it is 2
          x: 20 + col * 34,
          y: 20 + (row % 25) * 34,
          width: 28,
          height: 28,
          name: `Card ${i}`,
          props: { fills: [PALETTE[i % PALETTE.length]!] },
        },
      });
    }
    await editor.batch(steps as never, { label: 'spike: fill' });
  }
}

export function Spike() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <SpikeBody /> : null;
}

function SpikeBody() {
  const params = useRef(new URLSearchParams(window.location.search)).current;
  const file = params.get('file') ?? 'small';
  const mode = (params.get('sync') ?? 'pointer') as SyncMode;
  const pollMs = Number(params.get('pollMs') ?? 100);
  const canvasParam = params.get('canvas') ?? 'flag';
  const iframe = useRef<HTMLIFrameElement>(null);
  const [store] = useState(() => new SpikeStore());
  const state = useSpikeState(store);
  const [handle, setHandle] = useState<Handle | null>(null);
  const [status, setStatus] = useState('starting');
  const [canvasOn, setCanvasOn] = useState(canvasParam !== 'off');

  useEffect(() => {
    const el = iframe.current!;
    const query: Record<string, string | true> = {};
    if (params.get('webgl')) query.webgl = true;
    if (canvasParam === 'flag') query.canvas = true;
    const editor = createBridge({ iframe: el, author: 'Spike', query });
    let syncer: Syncer | null = null;
    let stopMessages = () => {};
    let cancelled = false;

    const loaded = (async () => {
      await editor.ready();
      if (cancelled) return { nodes: 0 };
      watchEditorFrames(el.contentWindow!);
      watchEditorInput(el.contentDocument!);
      const infos = await editor.commands();
      const commands = new Set(infos.map((c) => c.id));

      // The document.
      setStatus('loading document');
      if (file === 'large') {
        const bytes = new Uint8Array(
          await (await fetch('/spike/ridgeline-studio-dashboard.figcraft')).arrayBuffer(),
        );
        editor.open('ridgeline-studio-dashboard.figcraft', bytes);
        // `open` is a message; wait until the tree shows up.
        for (let i = 0; i < 400; i++) {
          const d = await editor.inspect({ depth: 0, fields: [] }).catch(() => null);
          if (d) break;
          await new Promise((r) => setTimeout(r, 50));
        }
      } else {
        await editor.execute('file.new' as never, { name: 'Spike' } as never);
        await buildGenerated(editor, file === 'stress' ? 5000 : 12);
      }

      // Canvas mode.
      if (canvasParam === 'flag') {
        if (commands.has('view.canvasMode')) {
          await editor.execute('view.canvasMode' as never, { on: true } as never);
        }
      } else if (canvasParam === 'toggle') {
        await editor.execute('view.toggleUi' as never, {} as never);
      }
      // The app chrome is dark (the mockup); the canvas follows it through the bridge.
      // The default canvas stays light under view.themeDark; the mockup's is dark. The spike sets the
      // page's background (an edit to the open document, which Story 2.1 should make unnecessary).
      if (params.get('theme') !== 'light' && params.get('bg') !== 'keep') {
        await editor.execute('view.themeDark' as never, {} as never);
        await editor.execute('page.setBackground' as never, { color: '#0b0c0a' } as never);
      }
      await editor.execute('view.zoomFit' as never, {} as never);

      const store_ = store;
      store_.set({ gestures: commands.has('edit.begin') });
      syncer = new Syncer(editor, store_, { mode, pollMs });
      // The host knows about its own writes: read back once each one lands (not the previews
      // of a scrub; the inspector shows the scrubbed value itself).
      const sy = syncer;
      const wrap = <A extends unknown[]>(fn: (...a: A) => Promise<unknown>, skip?: (a: A) => boolean) =>
        async (...a: A) => {
          try {
            return await fn(...a);
          } finally {
            if (mode !== 'events' && !skip?.(a) && !store_.paused) sy.request('own-edit');
          }
        };
      const exec0 = editor.execute.bind(editor);
      const req0 = editor.request.bind(editor);
      const batch0 = editor.batch.bind(editor);
      editor.execute = wrap(exec0 as never, (a) => String((a as unknown[])[0]).startsWith('select.')) as never;
      editor.request = wrap(req0 as never, (a) => (a as unknown[])[0] !== 'engine.execute') as never;
      editor.batch = wrap(batch0 as never) as never;
      store_.kick = () => sy.request('kick');
      const h: Handle = { editor, iframe: el, store: store_, syncer, commands };
      setHandle(h);

      // Editor events (Story 2.3, 2.11, 2.4): `window.parent.postMessage({type: 'figcraft:event', name, data})`.
      // Every mode counts them for the footer; only `sync=events` reads the document on them.
      const onMsg = (ev: MessageEvent) => {
        const m = ev.data as { type?: unknown; name?: unknown; data?: unknown } | null;
        if (m?.type !== 'figcraft:event' || typeof m.name !== 'string') return;
        // (The ping probe posts from this realm, so its `source` is this window.)
        if (ev.source !== el.contentWindow && m.name !== 'spike.ping') return;
        perf.log('event', { name: m.name });
        const seen = store_.current.eventsSeen;
        store_.set({ eventsSeen: { ...seen, [m.name]: (seen[m.name] ?? 0) + 1 }, lastEvent: JSON.stringify(m).slice(0, 160) });
        if (m.name === 'spike.ping') {
          store_.set({ ping: (m.data as { t0: number }).t0 });
        } else if (m.name.startsWith('agent.presence')) {
          const d = m.data as { active?: boolean } | undefined;
          if (typeof d?.active === 'boolean') store_.set({ agentActive: d.active });
        } else if (mode === 'events' && m.name === 'selection.changed') {
          syncer?.onSelectionEvent((m.data as { ids?: number[] }).ids ?? []);
        } else if (mode === 'events' && m.name === 'document.changed') {
          syncer?.onDocumentEvent();
        }
      };
      window.addEventListener('message', onMsg);
      stopMessages = () => window.removeEventListener('message', onMsg);
      syncer.start(el);
      const info = await editor.inspect({ outline: true, depth: 12 });
      let nodes = 0;
      const count = (n: { children?: unknown[] }) => {
        nodes++;
        (n.children as { children?: unknown[] }[] | undefined)?.forEach(count);
      };
      info.pages.forEach(count);
      setStatus(`ready (${nodes} nodes, ${file}, sync=${mode})`);
      window.__spike = { ...h, loaded: Promise.resolve({ nodes }) };
      return { nodes };
    })();
    loaded.catch((e) => setStatus(`error: ${e instanceof Error ? e.message : String(e)}`));
    if (typeof window !== 'undefined') {
      // The measure script awaits this.
      (window as unknown as { __spikeLoaded: Promise<unknown> }).__spikeLoaded = loaded;
    }
    return () => {
      cancelled = true;
      syncer?.dispose();
      stopMessages();
      editor.dispose();
    };
  }, [store, file, mode, pollMs, canvasParam, params]);

  useEffect(() => {
    if (state.ping) afterPaint(() => perf.log('ping-painted', { t0: state.ping }));
  }, [state.ping]);

  const editor = handle?.editor ?? null;
  const exec = (command: string, p: unknown) => editor?.execute(command as never, p as never);

  // Esc during a scrub is handled in ScrubField; these are the toolbar actions.
  const runAsClaude = async () => {
    if (!editor || !state.node) return;
    const id = state.node.id;
    const nextFill = state.node.fill === '#ff9a4d' ? '#3fd67f' : '#ff9a4d';
    perf.log('agent-run', { id });
    await editor.request('engine.execute', {
      command: 'node.set',
      params: { ids: [id], fill: nextFill, x: state.node.x + 8 },
      agent: 'Claude',
    });
  };
  const holdPresence = async (active: boolean) => {
    if (!editor) return;
    try {
      await editor.request('engine.execute', {
        command: 'agent.presence',
        params: { name: 'Claude', active },
      });
      store.set({ agentActive: active });
    } catch (e) {
      setStatus(`agent.presence: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div
      className="grid h-screen w-screen overflow-hidden bg-bg text-text"
      style={{ gridTemplateRows: '45px 1fr 26px', gridTemplateColumns: '312px 1fr 300px' }}
    >
      <header className="col-span-3 flex items-center gap-3 border-b border-border bg-surface px-4 text-sm">
        <span className="font-wordmark text-xl">Greenfield</span>
        <span className="text-muted">/ canvas-mode spike</span>
        <div className="ml-6 flex gap-1">
          {(['move', 'frame', 'rectangle', 'text'] as const).map((t) => (
            <button
              key={t}
              className="border border-border px-2 py-1 text-xs hover:bg-surface-2"
              onClick={() => exec(`tool.${t}`, {})}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <button
            data-testid="run-claude"
            className="border border-ember px-2 py-1 text-ember hover:bg-surface-2 disabled:opacity-40"
            disabled={!state.node}
            onClick={runAsClaude}
          >
            Run as Claude
          </button>
          <button
            data-testid="hold-presence"
            className="border border-border px-2 py-1 hover:bg-surface-2"
            onClick={() => holdPresence(!state.agentActive)}
          >
            {state.agentActive ? 'Release presence' : 'Hold presence'}
          </button>
          <button
            data-testid="canvas-toggle"
            className="border border-border px-2 py-1 hover:bg-surface-2"
            onClick={async () => {
              const next = !canvasOn;
              setCanvasOn(next);
              if (handle?.commands.has('view.canvasMode')) {
                await exec('view.canvasMode', { on: next });
              } else {
                await exec('view.toggleUi', {});
              }
            }}
          >
            {canvasOn ? 'Show editor panels' : 'Canvas only'}
          </button>
          <span
            className="px-2 py-1"
            style={state.agentActive ? { background: 'var(--ember)', color: 'var(--ember-ink)' } : {}}
          >
            Claude {state.agentActive ? 'editing' : 'idle'}
          </span>
        </div>
      </header>

      <aside className="overflow-hidden border-r border-border bg-surface">
        <div className="border-b border-border px-4 py-3 text-xs uppercase tracking-wider text-muted">
          Layers · {state.layers.length}
        </div>
        <LayersList layers={state.layers} selected={state.selection} onSelect={(id) => exec('select.set', { ids: [id] })} />
      </aside>

      <main className="relative overflow-hidden bg-bg">
        <iframe
          ref={iframe}
          title="Design canvas"
          data-testid="canvas"
          className="absolute inset-0 h-full w-full border-0"
          style={canvasParam === 'toggle' ? { top: -40, height: 'calc(100% + 40px)' } : undefined}
        />
      </main>

      <aside className="overflow-auto border-l border-border bg-surface">
        <Inspector store={store} editor={editor} gestures={state.gestures} />
      </aside>

      <footer
        data-testid="status"
        className="col-span-3 flex items-center gap-4 overflow-hidden whitespace-nowrap border-t border-border bg-surface px-4 font-mono text-[11px] text-muted"
      >
        <span>{status}</span>
        <span>rev {state.revision.slice(0, 24)}</span>
        <span data-ping={state.ping}>ping {Math.round(state.ping)}</span>
        <span>gestures {state.gestures ? 'yes' : 'no (node.set per move)'}</span>
        <span>events {JSON.stringify(state.eventsSeen)}</span>
        <span className="truncate">{state.lastEvent}</span>
      </footer>
    </div>
  );
}

function LayersList({
  layers,
  selected,
  onSelect,
}: {
  layers: LayerRow[];
  selected: number[];
  onSelect: (id: number) => void;
}) {
  const [top, setTop] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const height = 760;
  const first = Math.max(0, Math.floor(top / ROW_H) - 5);
  const last = Math.min(layers.length, first + Math.ceil(height / ROW_H) + 10);
  useEffect(() => {
    // Paint mark for the sync measurement: the list is on screen with `layers.length` rows.
    afterPaint(() => perf.log('layers-painted', { rows: layers.length, sig: layers.slice(0, 3).map((l) => l.name).join('|') }));
  }, [layers]);
  return (
    <div
      ref={box}
      data-testid="layers"
      data-rows={layers.length}
      className="overflow-auto"
      style={{ height }}
      onScroll={(e) => setTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: layers.length * ROW_H, position: 'relative' }}>
        {layers.slice(first, last).map((l, i) => (
          <button
            key={l.id}
            data-layer={l.id}
            onClick={() => onSelect(l.id)}
            className="absolute left-0 right-0 flex items-center gap-2 truncate px-4 text-left text-[13px] hover:bg-surface-2"
            style={{
              top: (first + i) * ROW_H,
              height: ROW_H,
              paddingLeft: 16 + l.depth * 14,
              background: selected.includes(l.id) ? 'var(--raise)' : undefined,
              borderLeft: selected.includes(l.id) ? '2px solid var(--field)' : '2px solid transparent',
              opacity: l.visible ? 1 : 0.4,
            }}
          >
            <span className="text-muted">{l.type.slice(0, 1)}</span>
            {l.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function Inspector({
  store,
  editor,
  gestures,
}: {
  store: SpikeStore;
  editor: Editor | null;
  gestures: boolean;
}) {
  const { node } = useSpikeState(store);
  useEffect(() => {
    // Paint mark for the click-to-inspector measurement.
    afterPaint(() =>
      perf.log('inspector-painted', {
        sig: node ? `${node.id}:${node.x},${node.y},${node.width},${node.height},${node.fill}` : 'none',
        id: node?.id ?? null,
      }),
    );
  }, [node]);
  if (!node) {
    return (
      <div data-testid="inspector" data-node="" className="p-4 text-sm text-muted">
        Nothing selected
      </div>
    );
  }
  const field = (key: 'x' | 'y' | 'width' | 'height', label: string) => (
    <ScrubField
      key={`${node.id}-${key}`}
      label={label}
      testId={`field-${key}`}
      value={node[key]}
      editor={editor}
      id={node.id}
      prop={key}
      gestures={gestures}
      store={store}
    />
  );
  return (
    <div data-testid="inspector" data-node={node.id}>
      <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-medium" data-testid="inspector-name">{node.name}</span>
        <span className="text-xs text-muted">{node.type}</span>
      </div>
      <div className="border-b border-border p-4">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted">Position</div>
        <div className="grid grid-cols-2 gap-2">
          {field('x', 'X')}
          {field('y', 'Y')}
          {field('width', 'W')}
          {field('height', 'H')}
        </div>
      </div>
      <div className="p-4">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted">Fill</div>
        <label className="flex items-center gap-2 bg-surface-2 px-2 py-1 text-sm">
          <input
            data-testid="field-fill"
            type="color"
            value={node.fill ?? '#000000'}
            onChange={(e) => editor?.execute('node.set', { ids: [node.id], fill: e.target.value } as never)}
          />
          <span className="font-mono">{node.fill ?? 'none'}</span>
        </label>
      </div>
    </div>
  );
}

/**
 * A number you scrub by dragging its label (Figma-style). Dragging makes one gesture: begin,
 * a preview per frame, commit on release; Esc cancels. The shown value follows the pointer at
 * once; the canvas follows when the editor has applied the preview.
 */
function ScrubField({
  label,
  value,
  testId,
  editor,
  id,
  prop,
  gestures,
  store,
}: {
  label: string;
  value: number;
  testId: string;
  editor: Editor | null;
  id: number;
  prop: string;
  gestures: boolean;
  store: SpikeStore;
}) {
  const [live, setLive] = useState<number | null>(null);
  const drag = useRef<{ scrub: Scrub; x0: number; v0: number } | null>(null);
  const shown = live ?? value;

  const start = (e: React.PointerEvent<HTMLElement>) => {
    if (!editor) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const scrub = new Scrub(editor, id, gestures, `Change ${label}`);
    store.paused = true;
    drag.current = { scrub, x0: e.clientX, v0: value };
    perf.log('scrub-start', { prop });
    void scrub.begin();
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const next = Math.round(d.v0 + (e.clientX - d.x0));
    setLive(next);
    d.scrub.preview({ [prop]: next }, performance.now());
  };
  const end = async (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    await d.scrub.commit();
    perf.log('scrub-commit', { prop });
    store.paused = false;
    store.kick();
    setLive(null);
  };
  const cancel = async () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    await d.scrub.cancel();
    perf.log('scrub-cancel', { prop });
    store.paused = false;
    store.kick();
    setLive(null);
  };
  // Esc goes to whatever has focus, which differs per browser mid-drag: listen on the window.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void cancel();
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex items-center bg-surface-2 text-sm">
      <span
        data-testid={`${testId}-label`}
        tabIndex={0}
        className="w-7 cursor-ew-resize select-none px-2 py-1 text-muted touch-none"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
      >
        {label}
      </span>
      <span data-testid={testId} className="px-1 py-1 font-mono">
        {Math.round(shown * 100) / 100}
      </span>
    </div>
  );
}
