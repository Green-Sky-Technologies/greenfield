/**
 * Tool execution seam for the agent loop.
 *
 * The HTML model's DesignDoc tools were removed in Story 1.2. The FigCraft tools are the
 * Story 1.4 contract; `executeTool(name, input, editor)` in `@greenfield/contracts` runs them
 * against a bridge `Editor`. Epic 4 implements this interface on top of it: interactive turns
 * run the calls in the browser through `packages/bridge`, jobs against headless `figcraft-cli`.
 */
import {
  AGENT_TOOLS,
  isAgentTool,
  type AgentRuntime,
  type AgentToolDef,
} from '@greenfield/contracts';
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
  if (!isAgentTool(name)) return toolFail(`Unknown tool: ${name}`);
  const def: AgentToolDef = AGENT_TOOLS[name];
  if (!def.runtimes.includes(host.runtime))
    return toolFail(
      host.runtime === 'job'
        ? `${name} is not available in a background job.`
        : `${name} is only available in background jobs. Offer to start one instead.`,
    );
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
