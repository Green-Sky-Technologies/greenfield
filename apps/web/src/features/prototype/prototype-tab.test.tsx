// @vitest-environment happy-dom
/**
 * The Prototype and Code tabs against a store with a stand-in editor: what they show from the
 * store's fields, and the `proto.*` / `inspect.code` commands they send. The real editor is
 * covered by e2e/editor/prototype-code.spec.ts.
 */
import type { Editor } from '@greenfield/bridge';
import { EditorStore, treeFromLayers, type NodeFields } from '@greenfield/editor-state';
import { EditorStateProvider } from '@greenfield/editor-state/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeTab } from '../code/code-tab';
import { actionPatch, transitionPatch, triggerPatch } from './interactions';
import { PrototypeTab } from './prototype-tab';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = 2;
const PRICING = 3;
const BUTTON = 4;
const link = {
  trigger: { type: 'onClick' },
  actions: [{ type: 'navigate', dest: PRICING }],
  transition: { type: 'smartAnimate' },
  duration_ms: 300,
  easing: 'easeOut',
};

let root: Root | null = null;
let host = document.createElement('div');

function mount(ui: React.ReactNode, selected: NodeFields, flows = [] as { start: number }[]) {
  const execute = vi.fn(async (command: string) =>
    command === 'inspect.code' ? { code: '.button {}', connected: false } : { ok: true },
  );
  const store = new EditorStore({
    document: { id: 1, revision: 1, undoDepth: 0, dirty: false },
    tree: treeFromLayers(1, [
      {
        id: HOME,
        name: 'Home',
        type: 'FRAME',
        children: [{ id: BUTTON, name: 'Button', type: 'RECTANGLE' }],
      },
      { id: PRICING, name: 'Pricing', type: 'FRAME' },
    ]),
    flows: flows.map((f) => ({ name: 'Flow 1', description: '', ...f })),
    selection: [selected.id],
    nodes: new Map([[selected.id, selected]]),
  });
  store.connect({
    onEvent: () => () => {},
    onDirty: () => () => {},
    onReady: () => () => {},
    execute,
  } as unknown as Editor);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<EditorStateProvider store={store}>{ui}</EditorStateProvider>));
  return { store, execute };
}

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  root = null;
  host.remove();
});

const select = (label: string) =>
  host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
const button = (text: string) =>
  [...host.querySelectorAll('button')].find(
    (b) => b.textContent?.includes(text) || b.getAttribute('aria-label') === text,
  )!;
const choose = (label: string, value: string) =>
  act(() => {
    const s = select(label);
    s.value = value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });

describe('interaction patches', () => {
  it('gives each new trigger, action and transition the fields the editor requires', () => {
    expect(triggerPatch('afterDelay')).toEqual({ trigger: { type: 'afterDelay', ms: 800 } });
    expect(actionPatch({ type: 'navigate', dest: 3 }, 'openOverlay', [2, 3])).toEqual({
      action: { type: 'openOverlay', dest: 3 },
    });
    expect(actionPatch({ type: 'back' }, 'navigate', [2])).toEqual({
      action: { type: 'navigate', dest: 2 },
    });
    expect(actionPatch({ type: 'back' }, 'navigate', [])).toBeNull();
    expect(actionPatch(undefined, 'openUrl', [])).toEqual({ action: { type: 'openUrl', url: '' } });
    expect(transitionPatch({ type: 'push', direction: 'top' }, 'slideIn')).toEqual({
      transition: { type: 'slideIn', direction: 'top' },
    });
    expect(transitionPatch({ type: 'push', direction: 'top' }, 'dissolve')).toEqual({
      transition: { type: 'dissolve' },
    });
  });
});

describe('PrototypeTab', () => {
  it("shows the layer's interaction and edits it with proto.interaction.set", () => {
    const { execute } = mount(<PrototypeTab />, {
      id: BUTTON,
      name: 'Button',
      interactions: [link],
    });
    expect(select('Interaction 1 trigger').value).toBe('onClick');
    expect(select('Interaction 1 destination').selectedOptions[0]!.textContent).toBe('Pricing');
    expect(select('Interaction 1 animation').value).toBe('smartAnimate');

    choose('Interaction 1 animation', 'push');
    expect(execute).toHaveBeenLastCalledWith('proto.interaction.set', {
      id: BUTTON,
      index: 0,
      transition: { type: 'push', direction: 'left' },
    });
    choose('Interaction 1 destination', String(HOME));
    expect(execute).toHaveBeenLastCalledWith('proto.interaction.set', {
      id: BUTTON,
      index: 0,
      action: { type: 'navigate', dest: HOME },
    });
    act(() => button('Remove interaction 1').click());
    expect(execute).toHaveBeenLastCalledWith('proto.interaction.remove', { id: BUTTON, index: 0 });
  });

  it("adds a link to another screen than the layer's own", () => {
    const { execute } = mount(<PrototypeTab />, { id: BUTTON, name: 'Button' });
    expect(host.textContent).toContain('No interactions.');
    act(() => button('Add interaction').click());
    expect(execute).toHaveBeenLastCalledWith('proto.interaction.add', {
      id: BUTTON,
      action: { type: 'navigate', dest: PRICING },
    });
  });

  it('starts and removes a flow on a top-level frame', () => {
    const { execute } = mount(<PrototypeTab />, { id: HOME, name: 'Home' });
    act(() => button('Add starting point').click());
    expect(execute).toHaveBeenLastCalledWith('proto.flow.add', { start: HOME });
    act(() => root!.unmount());
    host.remove();

    const flowed = mount(<PrototypeTab />, { id: HOME, name: 'Home' }, [{ start: HOME }]);
    expect(button('Add starting point')).toBeUndefined();
    expect(host.textContent).toContain('Starts at Home');
    act(() => button('Remove flow Flow 1').click());
    expect(flowed.execute).toHaveBeenLastCalledWith('proto.flow.remove', { start: HOME });
  });
});

describe('CodeTab', () => {
  it('generates code for the selection in the chosen language', async () => {
    vi.stubGlobal('IntersectionObserver', undefined); // on screen
    const { execute } = mount(<CodeTab />, { id: BUTTON, name: 'Button' });
    await act(async () => {});
    expect(execute).toHaveBeenLastCalledWith('inspect.code', { id: BUTTON, language: 'react' });
    expect(host.querySelector('pre')!.textContent).toBe('.button {}');
    choose('Language', 'swiftui');
    await act(async () => {});
    expect(execute).toHaveBeenLastCalledWith('inspect.code', { id: BUTTON, language: 'swiftui' });
  });
});
