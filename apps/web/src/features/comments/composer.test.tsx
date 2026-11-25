// @vitest-environment happy-dom
/** The canvas's `ui.request comment.new` opens the composer for people who may comment only. */
import type { Editor } from '@greenfield/bridge';
import { EditorStore } from '@greenfield/editor-state';
import { EditorStateProvider } from '@greenfield/editor-state/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Composer } from './composer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function open(canComment: boolean) {
  const store = new EditorStore();
  store.connect({
    onEvent: () => () => {},
    onDirty: () => () => {},
    onReady: () => () => {},
    execute: () => Promise.resolve(null),
  } as unknown as Editor);
  act(() =>
    root.render(
      <EditorStateProvider store={store}>
        <Composer canComment={canComment} />
      </EditorStateProvider>,
    ),
  );
  act(() =>
    store.dispatch({
      type: 'ui.request',
      kind: 'comment.new',
      screen: { x: 40, y: 40 },
      data: { x: 10, y: 10, ids: [4], ask: false },
    }),
  );
  return store;
}

const composer = () => host.querySelector('[aria-label="Comment or ask"]');

it('opens the composer for someone who may comment', () => {
  const store = open(true);
  expect(composer()).not.toBeNull();
  expect(store.getState().request).not.toBeNull();
});

it('shows a viewer no composer and lets the request go', () => {
  const store = open(false);
  expect(composer()).toBeNull();
  expect(store.getState().request).toBeNull();
});
