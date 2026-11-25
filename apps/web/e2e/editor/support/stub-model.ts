/**
 * A scripted stand-in for the Anthropic Messages API, so the agent pane's e2e runs real turns
 * through the app (proxy, metering, SSE, browser-run tools) without a model. Start the dev
 * server with `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>` and give the workspace an Anthropic
 * credential: the SDK then calls this server.
 *
 * The reply depends on the newest user turn:
 * - tool results or the self-check render: a short final answer;
 * - `[ask]`: follow-up questions (`ask_followup`);
 * - `[job]`: an offer of three alternatives as a background job (`suggest_generation_job`);
 * - `[slow]`: text streamed over ~15 s the first time a prompt is seen (to stop it), then fast;
 * - `[fail]`: a provider error, the first time a prompt is seen (to retry it);
 * - anything else: one `run_batch` that makes the first selected layer ember and renames it.
 */
import { createServer, type Server } from 'node:http';

type Block = { type: string; text?: string; name?: string; id?: string; [k: string]: unknown };
type Turn = { role: 'user' | 'assistant'; content: string | Block[] };

export const STUB_FILL = '#ff9a4d';

const blocks = (t: Turn | undefined): Block[] =>
  !t ? [] : typeof t.content === 'string' ? [{ type: 'text', text: t.content }] : t.content;

type Reply =
  | { kind: 'text'; text: string; delayMs?: number }
  | { kind: 'tool'; text?: string; name: string; input: unknown }
  | { kind: 'error'; status: number; message: string };

function reply(messages: Turn[], seen: Map<string, number>): Reply {
  const last = blocks(messages.at(-1));
  const results = last.filter((b) => b.type === 'tool_result');
  if (results.length) {
    const asked = blocks(messages.at(-2)).find((b) => b.type === 'tool_use')?.name;
    return {
      kind: 'text',
      text:
        asked === 'ask_followup'
          ? 'Thanks, designing with that.'
          : asked === 'suggest_generation_job'
            ? 'Start it when you are ready.'
            : 'Done: the card is ember.',
    };
  }
  const texts = last.filter((b) => b.type === 'text').map((b) => b.text ?? '');
  if (texts.some((t) => t.startsWith('Self-check'))) return { kind: 'text', text: 'Looks right.' };
  const prompt = texts.at(-1) ?? '';
  const context = texts.find((t) => t.startsWith('<document>')) ?? '';
  const scope = (context.match(/Selected \(the scope\): ([\d, ]+)/)?.[1] ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  const times = (seen.get(prompt) ?? 0) + 1;
  seen.set(prompt, times);

  if (prompt.includes('[ask]'))
    return {
      kind: 'tool',
      name: 'ask_followup',
      input: {
        intro: 'Before I design it, two quick questions:',
        questions: [
          {
            id: 'plans',
            prompt: 'How many plans?',
            kind: 'single',
            options: [
              { id: 'two', label: 'Two' },
              { id: 'three', label: 'Three' },
              { id: 'four', label: 'Four' },
            ],
            allowOther: false,
          },
          {
            id: 'extras',
            prompt: 'Anything to include?',
            kind: 'multi',
            options: [
              { id: 'faq', label: 'FAQ' },
              { id: 'table', label: 'Comparison table' },
            ],
            allowOther: true,
          },
        ],
      },
    };
  if (prompt.includes('[job]'))
    return {
      kind: 'tool',
      text: 'That is a bigger piece of work.',
      name: 'suggest_generation_job',
      input: {
        kind: 'alternatives',
        prompt: 'Three pricing layouts',
        ...(scope.length ? { frameIds: [String(scope[0])] } : {}),
        count: 3,
        reason: 'Three alternatives take a while: I’ll make them in the background on a copy.',
      },
    };
  if (prompt.includes('[slow]'))
    return times === 1
      ? {
          kind: 'text',
          text: 'Thinking about this slowly, word by word, '.repeat(12),
          delayMs: 250,
        }
      : { kind: 'text', text: 'Thinking about this slowly: done.' };
  if (prompt.includes('[fail]') && times === 1)
    return { kind: 'error', status: 400, message: 'The stub model refused this once.' };
  if (prompt.includes('[say]')) return { kind: 'text', text: 'Hello from the stub.' };
  const id = scope[0];
  if (!id) return { kind: 'text', text: 'Select a layer first.' };
  return {
    kind: 'tool',
    name: 'run_batch',
    input: {
      label: 'Make the card ember',
      commands: [
        { command: 'node.set', params: { id, props: { fill: STUB_FILL, name: 'Card (ember)' } } },
      ],
    },
  };
}

const sse = (type: string, data: object) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface StubModel {
  url: string;
  /** Model calls answered so far. */
  calls: number;
  close(): Promise<void>;
}

export async function startStubModel(port: number): Promise<StubModel> {
  const seen = new Map<string, number>();
  const state = { calls: 0 };
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      void (async () => {
        const path = (req.url ?? '').split('?')[0];
        if (path === '/v1/messages/count_tokens') {
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ input_tokens: 12 }));
        }
        if (path !== '/v1/messages') {
          res.writeHead(404).end();
          return;
        }
        state.calls++;
        const body = JSON.parse(raw) as { model: string; messages: Turn[] };
        const r = reply(body.messages, seen);
        if (r.kind === 'error') {
          res.writeHead(r.status, { 'content-type': 'application/json' });
          return res.end(
            JSON.stringify({
              type: 'error',
              error: { type: 'invalid_request_error', message: r.message },
            }),
          );
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(
          sse('message_start', {
            message: {
              id: `msg_stub_${state.calls}`,
              type: 'message',
              role: 'assistant',
              model: body.model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 100, output_tokens: 1 },
            },
          }),
        );
        let index = 0;
        const text = r.text;
        if (text) {
          res.write(
            sse('content_block_start', { index, content_block: { type: 'text', text: '' } }),
          );
          const words = r.kind === 'text' && r.delayMs ? text.split(/(?<= )/) : [text];
          for (const w of words) {
            if (res.destroyed) return;
            res.write(
              sse('content_block_delta', { index, delta: { type: 'text_delta', text: w } }),
            );
            if (r.kind === 'text' && r.delayMs) await sleep(r.delayMs);
          }
          res.write(sse('content_block_stop', { index }));
          index++;
        }
        if (r.kind === 'tool') {
          res.write(
            sse('content_block_start', {
              index,
              content_block: {
                type: 'tool_use',
                id: `toolu_stub_${state.calls}`,
                name: r.name,
                input: {},
              },
            }),
          );
          res.write(
            sse('content_block_delta', {
              index,
              delta: { type: 'input_json_delta', partial_json: JSON.stringify(r.input) },
            }),
          );
          res.write(sse('content_block_stop', { index }));
        }
        res.write(
          sse('message_delta', {
            delta: {
              stop_reason: r.kind === 'tool' ? 'tool_use' : 'end_turn',
              stop_sequence: null,
            },
            usage: { output_tokens: 40 },
          }),
        );
        res.write(sse('message_stop', {}));
        res.end();
      })();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${port}`,
    get calls() {
      return state.calls;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
