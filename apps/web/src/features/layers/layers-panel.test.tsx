// @vitest-environment happy-dom
/**
 * The Layers tab against a store fed by hand (the editor's events as actions) and a recording
 * `run`: what each gesture asks the editor, and what the list shows from the store. The real
 * editor is covered by e2e/editor/layers.spec.ts.
 */
import { EditorStore, type RawNode } from '@greenfield/editor-state';
import { EditorStateProvider } from '@greenfield/editor-state/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LayersPanel } from './layers-panel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DOC = 7;
let store: EditorStore;
let runs: [string, unknown][];
let root: Root;
let host: HTMLDivElement;

const layers: RawNode[] = [
  {
    id: 2,
    name: 'Card',
    type: 'FRAME',
    children: [
      { id: 3, name: 'Title', type: 'TEXT' },
      { id: 4, name: 'Button', type: 'INSTANCE', locked: true },
    ],
  },
  { id: 5, name: 'Note', type: 'TEXT', visible: false },
];

async function mount(rawLayers = layers) {
  store = new EditorStore();
  runs = [];
  store.run = (async (command: string, params: unknown) => {
    runs.push([command, params]);
  }) as EditorStore['run'];
  store.dispatch({
    type: 'document.loaded',
    document: { id: DOC, revision: 1, undoDepth: 0, dirty: false },
    pages: [
      { id: 1, name: 'Landing', current: true },
      { id: 10, name: 'Pricing', current: false },
    ],
    layers: rawLayers,
    selection: [],
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <EditorStateProvider store={store}>
        <LayersPanel />
      </EditorStateProvider>,
    ),
  );
}

beforeEach(() => mount());
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const items = () => [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')];
const names = () => items().map((i) => i.getAttribute('aria-label'));
const row = (name: string) => items().find((i) => i.getAttribute('aria-label') === name)!;
const button = (label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const click = (el: Element, init: MouseEventInit = {}) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
  });
const dispatch = (a: Parameters<EditorStore['dispatch']>[0]) => act(async () => store.dispatch(a));
const select = (ids: number[]) =>
  dispatch({ type: 'selection.changed', document: DOC, page: 1, ids });

describe('LayersPanel', () => {
  it('lists the page tree front-most first, with marks and flags', () => {
    expect(names()).toEqual(['Note', 'Card', 'Button', 'Title']);
    expect(row('Button').dataset.mark).toBe('instance');
    expect(row('Button').getAttribute('aria-level')).toBe('2');
    expect(row('Card').getAttribute('aria-expanded')).toBe('true');
    expect(button('Unlock Button').getAttribute('aria-pressed')).toBe('true');
    expect(button('Show Note').getAttribute('aria-pressed')).toBe('true');
    const status = row('Button').getAttribute('aria-describedby')!;
    expect(host.querySelector(`[id="${status}"]`)!.textContent).toBe('Instance, Locked');
  });

  it('selects by click, Shift-click and Cmd-click; shows the selection from the store', async () => {
    await click(row('Card'));
    expect(runs.at(-1)).toEqual(['select.set', { ids: [2] }]);
    await select([2]);
    expect(row('Card').getAttribute('aria-selected')).toBe('true');
    await click(row('Title'), { shiftKey: true });
    expect(runs.at(-1)).toEqual(['select.set', { ids: [2, 4, 3] }]);
    await click(row('Note'), { metaKey: true });
    expect(runs.at(-1)).toEqual(['select.set', { ids: [2, 5] }]);
  });

  it('collapses, and expands again to a layer selected on the canvas', async () => {
    await click(row('Card').querySelector('[data-action="toggle"]')!);
    expect(names()).toEqual(['Note', 'Card']);
    expect(row('Card').getAttribute('aria-expanded')).toBe('false');
    await select([3]);
    expect(names()).toEqual(['Note', 'Card', 'Button', 'Title']);
    expect(row('Title').getAttribute('aria-selected')).toBe('true');
  });

  it('renames on double-click; Esc keeps the old name', async () => {
    await act(async () => {
      row('Title').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Layer name"]')!;
    expect(input.value).toBe('Title');
    input.value = 'Headline';
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(runs.at(-1)).toEqual(['node.set', { ids: [3], name: 'Headline' }]);
    // The editor's event renames the row (one row's patch).
    await dispatch({
      type: 'document.changed',
      document: DOC,
      revision: 2,
      undoDepth: 1,
      nodes: [{ id: 3, name: 'Headline' }],
    });
    expect(names()).toContain('Headline');

    await act(async () => {
      row('Note').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const again = host.querySelector<HTMLInputElement>('input[aria-label="Layer name"]')!;
    again.value = 'Ignored';
    const n = runs.length;
    await act(async () => {
      again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(runs.length).toBe(n);
    expect(host.querySelector('input[aria-label="Layer name"]')).toBeNull();
  });

  it('locks and hides through node.set', async () => {
    await click(button('Lock Card'));
    expect(runs.at(-1)).toEqual(['node.set', { ids: [2], locked: true }]);
    await click(button('Show Note'));
    expect(runs.at(-1)).toEqual(['node.set', { ids: [5], visible: true }]);
    expect(runs.some(([c]) => c === 'select.set')).toBe(false);
  });

  it('moves and selects with the keyboard', async () => {
    await select([5]);
    const tree = host.querySelector<HTMLElement>('[role="tree"]')!;
    const key = (k: string, init: KeyboardEventInit = {}) =>
      act(async () => {
        tree.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
      });
    await key('ArrowDown');
    expect(runs.at(-1)).toEqual(['select.set', { ids: [2] }]);
    await key('ArrowLeft'); // collapses Card
    expect(names()).toEqual(['Note', 'Card']);
    await key('ArrowRight');
    await key('ArrowDown', { shiftKey: true });
    expect(runs.at(-1)).toEqual(['select.set', { ids: [2, 4] }]);
  });

  it('pages: switch, add, rename and delete', async () => {
    const pages = host.querySelector('ul[aria-label="Pages"]')!;
    expect(pages.querySelector('[aria-current="page"]')!.textContent).toBe('Landing');
    await click([...pages.querySelectorAll('button')].find((b) => b.textContent === 'Pricing')!);
    expect(runs.at(-1)).toEqual(['page.select', { id: 10 }]);
    await click(button('Add page'));
    expect(runs.at(-1)).toEqual(['page.add', { name: 'Page 3' }]);
    await click(button('Delete page Pricing'));
    expect(runs.at(-1)).toEqual(['page.delete', { id: 10 }]);
    await act(async () => {
      pages
        .querySelector('[aria-current="page"]')!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Page name"]')!;
    input.value = 'Home';
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(runs.at(-1)).toEqual(['page.rename', { id: 1, name: 'Home' }]);
  });

  it('renders only the rows in view of a large page', async () => {
    act(() => root.unmount());
    host.remove();
    await mount(
      Array.from({ length: 50 }, (_, f) => ({
        id: 1000 + f,
        name: `Frame ${f}`,
        type: 'FRAME',
        children: Array.from({ length: 100 }, (_, i) => ({
          id: 100_000 + f * 100 + i,
          name: `Card ${f}.${i}`,
          type: 'RECTANGLE',
        })),
      })),
    );
    expect(store.getState().tree.rows.length).toBe(5050);
    expect(items().length).toBeLessThan(100);
    const spacer = host.querySelector<HTMLElement>('[role="tree"] > div')!;
    expect(spacer.style.height).toBe(`${5050 * 28}px`);
  });
});
