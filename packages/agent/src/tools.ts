/**
 * Tool execution seam for the agent loop.
 *
 * The HTML model's DesignDoc tools were removed in Story 1.2. Epic 4 implements the FigCraft
 * tools (Story 1.4 contract) on top of this interface: interactive turns run them in the
 * browser through `packages/bridge`, jobs run them against headless `figcraft-cli`.
 */
import { AGENT_TOOLS, type AgentRuntime } from '@greenfield/contracts';
import type { z } from 'zod';
import { stableStringify } from './stable';

/** Where tool calls run. */
export interface ToolHost {
  runtime: AgentRuntime;
  /** Run one validated tool call. Throw ToolError for problems the model can act on. */
  run(name: string, input: unknown): Promise<ToolResult>;
}

export class ToolError extends Error {
  override name = 'ToolError';
}

export interface ToolResult {
  /** JSON text for the tool_result block. */
  content: string;
  isError: boolean;
  /** Node ids this call changed (empty for reads). */
  touched: string[];
}

export const toolOk = (data: unknown, touched: string[] = []): ToolResult => ({
  content: typeof data === 'string' ? data : stableStringify(data),
  isError: false,
  touched,
});

export const toolFail = (message: string): ToolResult => ({
  content: stableStringify({ error: message }),
  isError: true,
  touched: [],
});

/** Execute one tool call. Never throws for model mistakes; they come back as error results. */
export async function executeTool(
  host: ToolHost,
  name: string,
  rawInput: unknown,
): Promise<ToolResult> {
  const def = AGENT_TOOLS[name];
  if (!def) return toolFail(`Unknown tool: ${name}`);
  if (!def.runtimes.includes(host.runtime))
    return toolFail(`${name} is only available in background jobs. Offer to start one instead.`);
  const parsed = (def.input as z.ZodType).safeParse(rawInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return toolFail(
      `Invalid input for ${name}: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim(),
    );
  }
  try {
    return await host.run(name, parsed.data);
  } catch (e) {
    if (e instanceof ToolError) return toolFail(e.message);
    throw e;
  }
}
