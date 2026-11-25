// @vitest-environment happy-dom
/**
 * The pickers against a recording editor: panels open them through `open.ts`; the canvas's
 * `ui.request colorPicker` writes the paint through a gesture. The real editor is covered by
 * e2e/editor/styles-pickers.spec.ts.
 */
import type { Editor } from '@greenfield/bridge';
import { EditorStore } from '@greenfield/editor-state';
import { EditorStateProvider } from '@greenfield/editor-state/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openColourPicker, openFontPicker } from './open';

vi.mock('./actions', () => ({
  designSystemFontsAction: async () => ({ ok: true, data: ['Cormorant Garamond'] }),
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ projectId: 'p1' }) }));

const { PickerHost } = await import('./picker-host');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REPLIES: Record<string, unknown> = {
  'variable.list': {
    collections: [{ id: 'C', name: 'Brand', modes: [{ id: 'C/1', name: 'Light' }] }],
    variables: [
      {
        id: 'V1',
        name: 'ink/900',
        collection: 'C',
        resolvedType: 'color',
        values: { 'C/1': { type: 'color', value: { r: 0, g: 0, b: 0, a: 1 } } },
      },
    ],
  },
  'style.list': [
    { id: 'S1', name: 'Brand/Field', type: 'paint', paints: [] },
    { id: 'S2', name: 'Body', type: 'text', style: { font_family: 'IBM Plex Sans' } },
  ],
  'text.fonts': ['Inter', 'IBM Plex Sans'],
};

let executed: { command: string; params: unknown }[];
let store: EditorStore;
let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  executed = [];
  const editor = {
    execute: async (command: string, params: unknown) => {
      executed.push({ command, params });
      return REPLIES[command] ?? { ok: true };
    },
    onEvent: () => () => {},
    onDirty: () => () => {},
    onReady: () => () => {},
  } as unknown as Editor;
  store = new EditorStore();
  store.connect(editor);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <EditorStateProvider store={store}>
        <PickerHost />
      </EditorStateProvider>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const byText = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('button, [role="option"]')].find((b) =>
    b.textContent?.includes(text),
  )!;
const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));

describe('PickerHost', () => {
  it('opens the colour picker for a panel: a variable binds, Esc closes', async () => {
    const opts = {
      value: { hex: '#ff0000', opacity: 1 },
      onPreview: vi.fn(),
      onCommit: vi.fn(),
      onCancel: vi.fn(),
    };
    await act(async () => openColourPicker({ x: 10, y: 10 }, opts));
    await settle();
    const picker = document.querySelector('[data-testid="colour-picker"]')!;
    expect(picker).not.toBeNull();
    await act(async () => byText('Variables').click());
    await act(async () => byText('ink / 900').click());
    expect(opts.onCommit).toHaveBeenLastCalledWith({ variable: 'V1' });
    expect(document.querySelector('[data-testid="colour-bound"]')!.textContent).toBe(
      'Bound to ink / 900',
    );
    await act(async () => byText('Detach').click());
    expect(opts.onCommit).toHaveBeenLastCalledWith({ hex: '#000000', opacity: 1 });
    await act(async () =>
      picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(document.querySelector('[data-testid="colour-picker"]')).toBeNull();
    expect(opts.onCancel).toHaveBeenCalledOnce();
  });

  it('opening another picker cancels the first; the font picker lists the system first', async () => {
    const colour = {
      value: { style: 'S1' },
      onPreview: vi.fn(),
      onCommit: vi.fn(),
      onCancel: vi.fn(),
    };
    const font = { family: 'Inter', onCommit: vi.fn(), onCancel: vi.fn() };
    await act(async () => openColourPicker({ x: 0, y: 0 }, colour));
    await act(async () => openFontPicker({ x: 0, y: 0 }, font));
    await settle();
    expect(colour.onCancel).toHaveBeenCalledOnce();
    const rows = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(rows).toEqual([
      'Cormorant GaramondDesign system',
      'IBM Plex SansThis file',
      'InterInstalled',
    ]);
    await act(async () => byText('IBM Plex Sans').click());
    expect(font.onCommit).toHaveBeenCalledWith('IBM Plex Sans');
    expect(font.onCancel).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="font-picker"]')).toBeNull();
  });

  it("answers the canvas's colour request with one gesture per change", async () => {
    store.dispatch({
      type: 'nodes.loaded',
      nodes: [{ id: 7, fills: [{ type: 'solid', color: '#FF0000' }] }],
    });
    await act(async () =>
      store.dispatch({
        type: 'ui.request',
        kind: 'colorPicker',
        screen: { x: 50, y: 80 },
        data: { target: 'paint', slot: 'fill', index: 0, ids: [7] },
      }),
    );
    await settle();
    await act(async () => byText('Styles').click());
    await act(async () => byText('Brand / Field').click());
    await settle();
    expect(executed.filter((e) => e.command.startsWith('edit.')).map((e) => e.command)).toEqual([
      'edit.begin',
      'edit.preview',
      'edit.commit',
    ]);
    expect(executed.find((e) => e.command === 'edit.preview')!.params).toEqual({
      commands: [{ command: 'style.apply', params: { ids: [7], style: 'S1', target: 'fill' } }],
    });
    const picker = document.querySelector('[data-testid="colour-picker"]')!;
    await act(async () =>
      picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(store.getState().request).toBeNull();
  });
});
