/**
 * Runs an agent turn's tool calls in the browser, next to the editor (Story 4.2). Framework-free:
 * the agent pane feeds it every message view from the SSE stream.
 *
 * - Each call runs at most once: it's claimed on the server first (the idempotency key is the
 *   message and tool_use id; another tab or a reloaded page gets a refusal), and remembered here
 *   so a repeated view (SSE reconnects) never starts it again. Posting the result is retried;
 *   the server accepts a repeat from the same tab as a duplicate.
 * - Calls run in order, one at a time, through `executeTool` with the turn's scope: a batch that
 *   leaves the scope is undone and comes back as an error (`@greenfield/contracts`).
 * - Hidden tab: the bridge fails fast with `EditorHiddenError` (nothing ran). The runner keeps
 *   the claim, waits until the tab is shown and runs the call then: the turn pauses.
 * - A turn that ended (cancelled, closed tab) runs nothing more.
 */
import type { Editor } from '@greenfield/bridge';
import { executeTool, type ToolContent } from '@greenfield/contracts';

export interface ToolCallInfo {
  id: string;
  name: string;
  input: unknown;
  state: 'queued' | 'claimed' | 'done';
}

/** The parts of a message view the runner reads. */
export interface RunnableMessage {
  id: string;
  status: string;
  toolCalls: ToolCallInfo[];
  scope: number[] | null;
}

export interface ToolResultBody {
  clientId: string;
  content: ToolContent[];
  isError: boolean;
  touched: number[];
}

export interface ToolRunnerApi {
  /** True when this tab may run the call. */
  claim(messageId: string, toolUseId: string, clientId: string): Promise<boolean>;
  result(messageId: string, toolUseId: string, body: ToolResultBody): Promise<void>;
}

export interface ToolRunnerOptions {
  editor: () => Editor | null;
  api: ToolRunnerApi;
  /** This tab (page load). */
  clientId: string;
  /** Resolves when the tab is visible. */
  whenVisible: () => Promise<void>;
  /** Result bodies above this many characters drop their image (Vercel's request body limit). */
  maxResultChars?: number;
  onError?: (e: unknown) => void;
}

const ACTIVE = new Set(['pending', 'streaming']);

export class ToolRunner {
  private readonly started = new Set<string>();
  private readonly ended = new Set<string>();
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly o: ToolRunnerOptions) {}

  /** Start the view's queued calls (each once, in order). Resolves when they have run. */
  handle(view: RunnableMessage): Promise<void> {
    if (!ACTIVE.has(view.status)) {
      this.ended.add(view.id);
      return this.chain;
    }
    for (const call of view.toolCalls) {
      if (call.state === 'done') continue;
      const key = `${view.id}:${call.id}`;
      if (this.started.has(key)) continue;
      this.started.add(key);
      this.chain = this.chain
        .then(() => this.run(view, call))
        .catch((e: unknown) => this.o.onError?.(e));
    }
    return this.chain;
  }

  /** Stop running calls for a message (the user cancelled it). */
  end(messageId: string) {
    this.ended.add(messageId);
  }

  private async run(view: RunnableMessage, call: ToolCallInfo) {
    if (this.ended.has(view.id)) return;
    if (!(await this.o.api.claim(view.id, call.id, this.o.clientId))) return;
    for (;;) {
      if (this.ended.has(view.id)) return;
      const editor = this.o.editor();
      if (!editor) throw new Error('The editor is not open');
      const r = await executeTool(call.name, call.input, editor, {
        runtime: 'interactive',
        scope: view.scope,
      });
      if (!r.ok && r.error.kind === 'hidden') {
        await this.o.whenVisible();
        continue;
      }
      await this.post(view.id, call.id, {
        clientId: this.o.clientId,
        content: this.fit(r.content),
        isError: r.isError,
        touched: r.touched,
      });
      return;
    }
  }

  private fit(content: ToolContent[]): ToolContent[] {
    const max = this.o.maxResultChars ?? 4_000_000;
    if (JSON.stringify(content).length <= max) return content;
    const rest = content.filter((c) => c.type !== 'image');
    return [
      { type: 'text', text: 'The render was too large to send. Render again at a smaller scale.' },
      ...rest,
    ];
  }

  private async post(messageId: string, toolUseId: string, body: ToolResultBody) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.o.api.result(messageId, toolUseId, body);
      } catch (e) {
        if (attempt >= 4 || this.ended.has(messageId)) throw e;
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      }
    }
  }
}

/** The runner's API over the app's route (`/api/agent/messages/:id/tools/:toolUseId`). */
export const fetchToolRunnerApi = (fetcher: typeof fetch = fetch): ToolRunnerApi => {
  const post = (messageId: string, toolUseId: string, body: unknown) =>
    fetcher(
      `/api/agent/messages/${encodeURIComponent(messageId)}/tools/${encodeURIComponent(toolUseId)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
  return {
    async claim(messageId, toolUseId, clientId) {
      const r = await post(messageId, toolUseId, { action: 'claim', clientId });
      if (r.status === 409) return false;
      if (!r.ok) throw new Error(`Claim failed (${r.status})`);
      return true;
    },
    async result(messageId, toolUseId, body) {
      const r = await post(messageId, toolUseId, { action: 'result', ...body });
      // 409: the turn ended meanwhile; nothing to retry.
      if (!r.ok && r.status !== 409) throw new Error(`Result failed (${r.status})`);
    },
  };
};

/** Resolves once `doc` is visible. */
export function whenDocumentVisible(doc: Document = document): Promise<void> {
  if (doc.visibilityState !== 'hidden') return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => {
      if (doc.visibilityState === 'hidden') return;
      doc.removeEventListener('visibilitychange', on);
      resolve();
    };
    doc.addEventListener('visibilitychange', on);
  });
}
