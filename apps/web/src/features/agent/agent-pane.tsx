'use client';

/**
 * The Agent tab (Stories 5.2 and 5.5; designs 02/5.5, 02/4.7, 03/4.4, 03/4.5): the project chat
 * with Claude. A message goes with the current selection (the chip above the box) as its scope;
 * the reply streams in with its steps, then lists what it changed, asks its questions, or offers
 * and follows a background job. While a reply runs, Claude holds its presence on the canvas
 * (its avatar ringed in ember, its outline on the layers it edits, Story 2.4) and a new message
 * waits its turn.
 */
import { useUser } from '@clerk/nextjs';
import type { Editor } from '@greenfield/bridge';
import { useDocument, useEditorStore, useSelection } from '@greenfield/editor-state/react';
import { useEffect, useRef, useState } from 'react';
import { modelName } from './format';
import { ClaudeMessage, UserMessage } from './message';
import { SelectionChip } from './selection-chip';
import { useAgentChat } from './use-agent-chat';

interface Props {
  projectId: string;
  editor: () => Editor | null;
}

/** Claude's presence on the canvas, held for as long as a reply runs. */
function useClaudePresence(running: boolean) {
  const store = useEditorStore();
  const open = !!useDocument();
  useEffect(() => {
    if (!running || !open) return;
    store.run('agent.presence', { name: 'Claude', active: true }).catch(() => {});
    return () => {
      store.run('agent.presence', { name: 'Claude', active: false }).catch(() => {});
    };
  }, [running, open, store]);
}

export function AgentPane({ projectId, editor }: Props) {
  const chat = useAgentChat(projectId, editor);
  useClaudePresence(chat.running);
  const { user } = useUser();
  const selection = useSelection();
  const [prompt, setPrompt] = useState('');
  const list = useRef<HTMLOListElement>(null);
  const { messages } = chat;
  const model = modelName(messages.findLast((m) => m.role === 'assistant')?.model);

  // Follow the conversation as it grows.
  const last = messages.at(-1);
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, last?.text, last?.status]);

  const submit = () => {
    const text = prompt.trim();
    if (!text || chat.sending) return;
    setPrompt('');
    void chat.send(text);
  };

  return (
    <section
      data-testid="agent-panel"
      aria-label="Agent"
      className="flex min-h-0 flex-1 flex-col text-sm"
    >
      <ol
        ref={list}
        aria-label="Conversation"
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 && (
          <li className="text-[13px] text-muted">
            Ask about the selection, or describe a change. Claude edits beside you; each of its
            edits is one undo step.
          </li>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <UserMessage key={m.id} message={m} name={user?.firstName ?? 'You'} />
          ) : (
            <ClaudeMessage
              key={m.id}
              message={m}
              asked={messages.slice(0, i).findLast((x) => x.role === 'user')}
              chat={chat}
              editor={editor}
            />
          ),
        )}
      </ol>
      {chat.error && (
        <p role="alert" className="px-4 pb-2 text-xs text-danger">
          {chat.error}
        </p>
      )}
      <form
        className="space-y-2 border-t border-border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          {selection.length ? (
            <>
              With <SelectionChip ids={selection} /> selected
            </>
          ) : (
            'Nothing selected: Claude works on the whole page'
          )}
        </p>
        {chat.queued && (
          <p data-testid="queued" className="truncate text-xs text-muted">
            Next: {chat.queued}
          </p>
        )}
        <textarea
          aria-label="Message Claude"
          className="input min-h-[70px] resize-none"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            submit();
          }}
          placeholder={
            chat.running
              ? 'Queue another request for Claude'
              : 'Ask about the selection, or describe a new screen'
          }
        />
        <div className="flex items-center justify-end gap-3">
          <span className="font-mono text-[11px] text-muted">
            {model ? `${model} · this file` : 'this file'}
          </span>
          <button
            type="submit"
            className="btn bg-text px-3 py-1 text-bg"
            disabled={chat.sending || !prompt.trim()}
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
