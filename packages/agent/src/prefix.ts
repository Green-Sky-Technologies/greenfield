/**
 * The cacheable prompt prefix (SPEC §2, ADR 0002): tools, then the system prompt. Both are
 * byte-stable for a given runtime: static text, tools sorted by name, schemas with sorted keys.
 * Nothing per-request (time, ids, user names, the document) goes here; that lives in the user
 * turn.
 *
 * The HTML model's prompt and design-system block were removed in Story 1.2; Epic 4 writes the
 * FigCraft prompt (command batches through the bridge). The tools come from the Story 1.4
 * contract (`@greenfield/contracts`), including the interactive-only control tools.
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  ASK_FOLLOWUP_TOOL,
  SUGGEST_JOB_TOOL,
  suggestJobInput,
  type AgentRuntime,
  type JobSuggestion,
} from '@greenfield/contracts';
import { contractToolDefs } from './tool-defs';

/** The job hand-off tool (Story 4.5) is part of the tool contract; re-exported for the loop. */
export { SUGGEST_JOB_TOOL, suggestJobInput, type JobSuggestion };

export type CacheTtl = '5m' | '1h';

/**
 * TTL for the tools + system prefix (ADR 0002): 1h by default, so members who pause 5–60
 * minutes between prompts still hit the cache. AGENT_PREFIX_CACHE_TTL=5m switches it for
 * measurement.
 */
export function prefixCacheTtl(env: Record<string, string | undefined> = process.env): CacheTtl {
  return env.AGENT_PREFIX_CACHE_TTL === '5m' ? '5m' : '1h';
}

const SYSTEM_COMMON = `You are Greenfield's design agent. You work in a vector design editor.

Keep replies short: say what you changed in one or two sentences.`;

const SYSTEM_INTERACTIVE = `${SYSTEM_COMMON}

You are on the quick-edit path. If the request needs new pages or frames, redesigning whole frames, or several alternatives, call ${SUGGEST_JOB_TOOL} and briefly tell the user why. Ask follow-up questions with ${ASK_FOLLOWUP_TOOL} only when the request is genuinely ambiguous; the call ends your turn.`;

const SYSTEM_JOB = `${SYSTEM_COMMON}

You are running as a background job. Finish with a short summary of what you changed.`;

export function systemPromptFor(runtime: AgentRuntime): string {
  return runtime === 'interactive' ? SYSTEM_INTERACTIVE : SYSTEM_JOB;
}

/** Tools for a runtime: the contract's definitions, sorted by name (cache-stable). */
export function toolsForPrefix(runtime: AgentRuntime): Anthropic.Tool[] {
  return contractToolDefs(runtime).map(
    (d) =>
      ({
        name: d.name,
        description: d.description,
        input_schema: d.input_schema,
      }) as Anthropic.Tool,
  );
}

export interface Prefix {
  system: Anthropic.TextBlockParam[];
  tools: Anthropic.Tool[];
}

/**
 * Build the prefix. The cache breakpoint sits on the system prompt, which renders after the
 * tools, so one entry covers both.
 */
export function buildPrefix(runtime: AgentRuntime, ttl: CacheTtl = '1h'): Prefix {
  return {
    tools: toolsForPrefix(runtime),
    system: [
      {
        type: 'text',
        text: systemPromptFor(runtime),
        cache_control: ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' },
      },
    ],
  };
}

/** The prefix exactly as it goes on the wire (tools render first), for stability tests. */
export const prefixBytes = (p: Prefix) => JSON.stringify({ tools: p.tools, system: p.system });
