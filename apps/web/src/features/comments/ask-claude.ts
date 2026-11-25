'use client';

/**
 * Ask Claude from a comment (Story 6.2): one action from a note to an agent turn scoped to the
 * element it's on. The thread goes along as context (`comment.prompt`), and the agent pane runs
 * the turn (`features/agent/ask.ts`) like a typed message, scoped to the thread's layers.
 */
import type { NodeId } from '@greenfield/bridge';
import type { EditorStore } from '@greenfield/editor-state';
import { askClaude as askAgent } from '@/features/agent/ask';

export interface AskInput {
  threadId: number;
  nodeIds: readonly NodeId[];
  /** What to ask, when it isn't just "do what the thread says". */
  request?: string;
}

/** The turn's prompt: the request, then the thread it came from. */
export function askPrompt(threadId: number, brief: string, request?: string): string {
  const ask = request?.trim() || 'Do what this comment thread asks.';
  return [
    ask,
    `This came from comment thread ${threadId} on the canvas:`,
    brief.trim(),
    'When you are done, reply in that thread (comment_thread) with one line on what you changed.',
  ].join('\n\n');
}

export async function askClaude(store: EditorStore, input: AskInput): Promise<void> {
  const brief = (await store.run('comment.prompt', { ids: [input.threadId] })) as { text: string };
  askAgent({
    prompt: askPrompt(input.threadId, brief.text, input.request),
    scope: input.nodeIds.length ? [...input.nodeIds] : null,
  });
}
