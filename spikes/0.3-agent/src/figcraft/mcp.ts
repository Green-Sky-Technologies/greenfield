/** MCP stdio client for a headless `figcraft-cli mcp` session (one untitled document per process). */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPIKE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const FIGCRAFT_BIN =
  process.env.FIGCRAFT_CLI ?? join(SPIKE_DIR, 'figcraft/target/release/figcraft-cli');

export interface ToolContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}
export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export interface FigcraftSession {
  client: Client;
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  /** Call a tool and parse its first text block as JSON; throws on isError. */
  json<T = unknown>(name: string, args: Record<string, unknown>): Promise<T>;
  /** `run_command` shortcut returning parsed JSON. */
  cmd<T = unknown>(command: string, params?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

export function textOf(r: ToolResult): string {
  return r.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
}

export async function startFigcraft(
  opts: { noSystemFonts?: boolean; writeRoot?: string } = {},
): Promise<FigcraftSession> {
  if (!existsSync(FIGCRAFT_BIN))
    throw new Error(
      `figcraft-cli not found at ${FIGCRAFT_BIN}. Build it: (cd spikes/0.3-agent/figcraft && cargo build --release -p figcraft-cli)`,
    );
  const args = ['mcp'];
  if (opts.noSystemFonts) args.push('--no-system-fonts');
  if (opts.writeRoot) args.push('--automation-write-root', opts.writeRoot);
  const transport = new StdioClientTransport({ command: FIGCRAFT_BIN, args, stderr: 'ignore' });
  const client = new Client({ name: 'spike-0.3-agent', version: '0.0.0' });
  await client.connect(transport);
  const call = async (name: string, a: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: a }, undefined, {
      timeout: 120_000,
    })) as ToolResult;
  const json = async <T>(name: string, a: Record<string, unknown>) => {
    const r = await call(name, a);
    const t = textOf(r);
    if (r.isError) throw new Error(`${name} failed: ${t.slice(0, 2000)}`);
    try {
      return JSON.parse(t) as T;
    } catch {
      return t as T;
    }
  };
  return {
    client,
    call,
    json,
    cmd: (command, params = {}) => json('run_command', { command, params }),
    close: () => client.close(),
  };
}
