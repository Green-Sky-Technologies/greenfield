/**
 * Agent tool contract. Names, descriptions and input schemas shared by both agent runtimes
 * (the interactive Messages API path and Agent SDK sandbox jobs). Nobody else should redefine
 * these shapes.
 *
 * Tool descriptions are part of the cached prompt prefix, so keep them byte-stable (no
 * timestamps or dynamic content).
 */
import type { z } from 'zod';

export const AGENT_RUNTIMES = ['interactive', 'job'] as const;
export type AgentRuntime = (typeof AGENT_RUNTIMES)[number];

export interface AgentToolDef<I extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: I;
  runtimes: readonly AgentRuntime[];
}

/**
 * The registry is empty until Story 1.4 defines the FigCraft tools (`get_selection`,
 * `get_outline`, `get_node`, `run_batch`, `render`, `list_commands`, `ask_followup`,
 * `comment_thread`). The DesignDoc tools of the HTML model were removed in Story 1.2.
 */
export const AGENT_TOOLS: Readonly<Record<string, AgentToolDef>> = {};

/** Tools available to a runtime, in a stable order (cache-friendly). */
export function toolsFor(runtime: AgentRuntime): AgentToolDef[] {
  return Object.keys(AGENT_TOOLS)
    .sort()
    .map((k) => AGENT_TOOLS[k]!)
    .filter((t) => t.runtimes.includes(runtime));
}
