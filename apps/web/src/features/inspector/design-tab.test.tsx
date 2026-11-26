// @vitest-environment happy-dom
/**
 * The Design tab against a store fed recorded editor payloads and an editor that records what it
 * is asked to run: typed values, scrubs as one gesture (Esc cancels), mixed values, the font
 * picker, and "changed by Claude · Revert". The real editor: e2e/editor/inspector.spec.ts.
 */
import type { Editor } from '@greenfield/bridge';
import { EditorStore, type NodeFields } from '@greenfield/editor-state';
import { EditorStateProvider } from '@greenfield/editor-state/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPickers } from '@/features/pickers/open';
import { DesignTab } from './design-tab';

vi.mock('next/navigation', () => ({ useParams: () => ({ slug: 'acme', projectId: 'p1' }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rect: NodeFields = {
  id: 4,
  name: 'Swatch',
  type: 'RECTANGLE',
  x: 120,
  y: 90,
  width: 160,
  height: 120,
  fills: [{ type: 'solid', color: '#3FD67F' }],
};
const text: NodeFields = {
  id: 3,
  name: 'Headline',
  type: 'TEXT',
  x: 16,
  y: 8,
  width: 68,
  height: 36,
  fontFamily: 'Inter',
  fontStyle: 'Bold',
  fontSize: 24,
  lineHeight: '150%',
  letterSpacing: '0%',
  textAlign: 'left',
  fills: [{ type: 'solid', color: '#000000' }],
};

let root: Root;
let host: HTMLDivElement;
let calls: { command: string; params: unknown }[];

function mount(nodes: NodeFields[]) {
  calls = [];
  const editor = {
    onEvent: () => () => {},
    onDirty: () => () => {},
    onReady: () => () => {},
    execute: (command: string, params: unknown) => {
      // The styles section (5.9) reads the file's styles and variables on mount; record edits only.
      if (command.endsWith('.list')) return Promise.resolve([]);
      calls.push({ command, params });
      return Promise.resolve(null);
    },
    batch: (steps: { command: string; params: unknown }[]) => {
      calls.push({ command: 'command.batch', params: steps });
      return Promise.resolve([]);
    },
  } as unknown as Editor;
  const store = new EditorStore();
  store.connect(editor);
  store.dispatch({
    type: 'document.loaded',
    document: { id: 1, revision: 1, undoDepth: 0, dirty: false },
    pages: [{ id: 1, name: 'Page 1', current: true }],
    layers: nodes.map((n) => ({ id: n.id, name: String(n.name), type: String(n.type) })),
    selection: [],
  });
  store.dispatch({
    type: 'selection.changed',
    document: 1,
    page: 1,
    ids: nodes.map((n) => n.id),
    nodes,
  });
  act(() =>
    root.render(
      <EditorStateProvider store={store}>
        <DesignTab projectId="p1" />
      </EditorStateProvider>,
    ),
  );
  return store;
}

const input = (name: string) => host.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!;
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

function type(el: HTMLInputElement, value: string) {
  act(() => {
    el.focus();
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

function pointer(el: Element, kind: string, clientX: number) {
  act(() => {
    el.dispatchEvent(
      new PointerEvent(kind, {
        bubbles: true,
        button: 0,
        clientX,
        pointerId: 1,
      } as PointerEventInit),
    );
  });
}

/** The app's routes the tab reads: the project's conversation and its design system. */
function stubFetch(conversation: unknown, designSystem: unknown = null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/design-system')
        ? designSystem
          ? Response.json(designSystem)
          : new Response(null, { status: 404 })
        : Response.json(conversation),
    ),
  );
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  stubFetch({ conversationId: null, messages: [] });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('Design tab', () => {
  it("shows the file's design system, with or without a selection (Story 10.5)", async () => {
    stubFetch(
      { conversationId: null, messages: [] },
      {
        system: { id: 's1', name: 'Voirdire' },
        version: 3,
        published: 4,
        counts: { colours: 13, type: 9, components: 41, spacing: 8 },
      },
    );
    const section = () => host.querySelector('[aria-label="Design system"]');
    mount([]);
    await flush();
    expect(section()?.textContent).toContain('Voirdire · v3');
    expect(section()?.textContent).toContain('Components41');
    expect(section()?.textContent).toContain('v4 is published');
    // The system is a menu: it opens the system in Settings, to review the newer version.
    const toggle = section()!.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
    act(() => toggle.click());
    const item = section()!.querySelector<HTMLAnchorElement>('[role="menuitem"]')!;
    expect(item.textContent).toBe('Review v4 in Settings');
    expect(item.getAttribute('href')).toBe('/w/acme/settings/design-systems/s1');
    mount([rect]);
    await flush();
    expect(section()?.textContent).toContain('Voirdire · v3');
    expect(calls).toEqual([]);
  });

  it('shows the selected layer and sets a typed value', async () => {
    mount([rect]);
    expect(host.querySelector('[data-testid=design-tab-name]')!.textContent).toBe('Swatch');
    expect(input('X position').value).toBe('120');
    expect(input('Fill 1 hex').value).toBe('3FD67F');
    type(input('X position'), '200');
    await flush();
    expect(calls).toEqual([{ command: 'node.set', params: { ids: [4], x: 200 } }]);
  });

  it('scrubs a number as one gesture, and Esc cancels a scrub', async () => {
    mount([rect]);
    const handle = host.querySelector('[data-testid=design-width-scrub]')!;
    pointer(handle, 'pointerdown', 100);
    pointer(handle, 'pointermove', 105);
    pointer(handle, 'pointermove', 110);
    pointer(handle, 'pointerup', 110);
    await flush();
    const commands = calls.map((c) => c.command);
    expect(commands[0]).toBe('edit.begin');
    expect(commands.at(-1)).toBe('edit.commit');
    const last = calls.filter((c) => c.command === 'edit.preview').at(-1)!.params as {
      commands: { params: { width: number } }[];
    };
    expect(last.commands[0]!.params.width).toBe(170);

    calls.length = 0;
    pointer(handle, 'pointerdown', 100);
    pointer(handle, 'pointermove', 140);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flush();
    expect(calls.map((c) => c.command).at(-1)).toBe('edit.cancel');
  });

  it('shows shared values and "Mixed" for several layers, and sets them all', async () => {
    mount([rect, { ...rect, id: 5, x: 300 }]);
    expect(host.querySelector('[data-testid=design-tab-name]')!.textContent).toBe('2 layers');
    expect(input('X position').value).toBe('');
    expect(input('X position').placeholder).toBe('Mixed');
    expect(input('Width').value).toBe('160');
    type(input('X position'), '50');
    await flush();
    expect(calls).toEqual([{ command: 'node.set', params: { ids: [4, 5], x: 50 } }]);
  });

  it('opens the font picker for a text layer and applies the family', async () => {
    mount([text]);
    const opened: string[] = [];
    const off = registerPickers({
      colour: () => {},
      font: (_at, opts) => {
        opened.push(opts.family);
        opts.onCommit('IBM Plex Sans');
      },
    });
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Font family"]')!.click());
    await flush();
    off();
    expect(opened).toEqual(['Inter']);
    expect(calls).toEqual([
      { command: 'node.set', params: { ids: [3], fontFamily: 'IBM Plex Sans' } },
    ]);
    expect(input('Line height').value).toBe('150%');
  });

  it('follows the colour picker: each commit is one step, closing reverts only an open drag', async () => {
    mount([rect]);
    let picker: Parameters<Parameters<typeof registerPickers>[0]['colour']>[1] | null = null;
    const off = registerPickers({ colour: (_at, opts) => (picker = opts), font: () => {} });
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Fill 1 colour"]')!.click());
    off();
    const p = picker!;
    expect(p.value).toEqual({ hex: '#3FD67F', opacity: 1 });
    p.onPreview({ hex: '#000001', opacity: 1 });
    p.onPreview({ hex: '#000002', opacity: 1 });
    p.onCommit({ hex: '#000002', opacity: 1 });
    await flush();
    p.onCommit({ hex: '#FF9A4D', opacity: 1 }); // a swatch click: no drag before it
    await flush();
    p.onPreview({ hex: '#000003', opacity: 1 });
    await flush();
    p.onCancel();
    await flush();
    expect(calls.map((c) => c.command)).toEqual([
      'edit.begin',
      'edit.preview',
      'edit.commit',
      'edit.begin',
      'edit.preview',
      'edit.commit',
      'edit.begin',
      'edit.preview',
      'edit.cancel',
    ]);
  });

  it('marks what Claude changed in the last turn and reverts it as one step', async () => {
    const before = [{ type: 'solid', color: '#14150F' }];
    stubFetch({
      conversationId: 'c1',
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          createdAt: new Date().toISOString(),
          reverted: null,
          changes: [
            { id: 4, kind: 'changed', fields: [{ field: 'fills', before, after: rect.fills }] },
          ],
        },
      ],
    });
    const store = mount([rect]);
    await flush();
    const note = host.querySelector('[data-testid=changed-by-claude]')!;
    expect(note.textContent).toContain('Fill changed by Claude, just now');
    expect(host.querySelector('[data-testid=fill-row]')!.getAttribute('data-changed')).toBe('true');
    act(() => note.querySelector('button')!.click());
    await flush();
    expect(calls).toEqual([{ command: 'node.set', params: { id: 4, props: { fills: before } } }]);

    // The editor reports the old fill: the mark goes.
    act(() =>
      store.dispatch({
        type: 'document.changed',
        document: 1,
        revision: 2,
        undoDepth: 1,
        nodes: [{ id: 4, fills: before }],
      }),
    );
    expect(host.querySelector('[data-testid=changed-by-claude]')).toBeNull();
  });
});
