// @vitest-environment happy-dom
/** A finished reply shows its design-system check (Story 10.5) under what it changed. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { MessageView } from '@/server/services/agent';
import { ClaudeMessage } from './message';
import type { AgentChat } from './use-agent-chat';

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

const reply = (over: Partial<MessageView>) =>
  ({
    id: 'm2',
    role: 'assistant',
    status: 'complete',
    text: 'Added the FAQ.',
    changes: [],
    designCheck: null,
    ...over,
  }) as MessageView;

const render = (m: MessageView) =>
  act(() =>
    root.render(
      <ul>
        <ClaudeMessage
          message={m}
          asked={undefined}
          chat={{ activity: {}, sending: false, running: false } as unknown as AgentChat}
          editor={() => null}
        />
      </ul>,
    ),
  );

it('shows the design-system check of a finished reply, and none while it runs', () => {
  const designCheck = {
    system: 'Voirdire',
    fixed: ['Replaced #e1472f with primary on 2 layers.'],
    left: [
      {
        kind: 'spacing' as const,
        field: 'gap',
        value: 18,
        layers: [{ id: 4, name: 'FAQ' }],
        suggestion: { name: 'space/4', value: 16 },
      },
    ],
  };
  render(reply({ designCheck, status: 'streaming' }));
  expect(host.querySelector('[aria-label="Checked against Voirdire"]')).toBeNull();

  render(reply({ designCheck }));
  const card = host.querySelector('[aria-label="Checked against Voirdire"]');
  expect(card?.textContent).toContain('1 fixed · 1 left');
  expect(card?.textContent).toContain('Replaced #e1472f with primary on 2 layers.');
  expect(card?.textContent).toContain('gap 18 off the scale on 1 layer (use space/4).');

  render(reply({}));
  expect(host.querySelector('[aria-label^="Checked against"]')).toBeNull();
});
