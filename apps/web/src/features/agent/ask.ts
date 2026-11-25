/**
 * "Ask Claude" from elsewhere in the shell (Comment or ask, Story 6.2; a comment thread, 6.4):
 * the Agent pane sends the request as a chat message on `scope`, like one typed in the pane.
 */
export interface AskClaude {
  prompt: string;
  /** The layers the turn may change; null for the whole page. */
  scope: number[] | null;
}

const EVENT = 'greenfield:ask-claude';

export function askClaude(request: AskClaude) {
  window.dispatchEvent(new CustomEvent<AskClaude>(EVENT, { detail: request }));
}

export function onAskClaude(cb: (request: AskClaude) => void): () => void {
  const listener = (e: Event) => cb((e as CustomEvent<AskClaude>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
