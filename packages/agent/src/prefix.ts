/**
 * The cacheable prompt prefix (SPEC §2, ADR 0002): tools, then the system prompt. Both are
 * byte-stable for a given runtime: static text, tools sorted by name, schemas with sorted keys.
 * Nothing per-request (time, ids, user names, the document) goes here; that lives in the user
 * turn.
 *
 * The HTML model's prompt and design-system block were removed in Story 1.2; Epic 4 writes the
 * FigCraft prompt (command batches through the bridge).
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentRuntime } from '@greenfield/contracts';
import { z } from 'zod';
import { contractToolDefs, jsonSchemaFor, type JsonToolDef } from './tool-defs';
import { ASK_QUESTIONS_DESCRIPTION, ASK_QUESTIONS_TOOL, askQuestionsInput } from './questions';

export type CacheTtl = '5m' | '1h';

/**
 * TTL for the tools + system prefix (ADR 0002): 1h by default, so members who pause 5–60
 * minutes between prompts still hit the cache. AGENT_PREFIX_CACHE_TTL=5m switches it for
 * measurement.
 */
export function prefixCacheTtl(env: Record<string, string | undefined> = process.env): CacheTtl {
  return env.AGENT_PREFIX_CACHE_TTL === '5m' ? '5m' : '1h';
}

/** Interactive-only tool: hand a too-big request over to a generation job (Story 5.4 AC). */
export const SUGGEST_JOB_TOOL = 'suggest_generation_job';
export const suggestJobInput = z
  .object({
    kind: z.enum(['generate', 'redesign', 'alternatives']),
    prompt: z.string().min(1).max(4000),
    frameIds: z.array(z.string()).max(20).optional(),
    count: z.number().int().min(2).max(5).optional(),
    reason: z.string().max(400),
  })
  .strict();
export type JobSuggestion = z.infer<typeof suggestJobInput>;

const suggestJobDef: JsonToolDef = {
  name: SUGGEST_JOB_TOOL,
  description:
    'Offer the user a background generation job instead of editing now. Use it when the request needs new pages or frames, a redesign of whole frames, or several alternatives. The user decides whether to start it.',
  input_schema: jsonSchemaFor(suggestJobInput),
};

const askQuestionsDef: JsonToolDef = {
  name: ASK_QUESTIONS_TOOL,
  description: ASK_QUESTIONS_DESCRIPTION,
  input_schema: jsonSchemaFor(askQuestionsInput),
};

const SYSTEM_COMMON = `You are Greenfield's design agent. You work in a vector design editor.

Keep replies short: say what you changed in one or two sentences.`;

const SYSTEM_INTERACTIVE = `${SYSTEM_COMMON}

You are on the quick-edit path. If the request needs new pages or frames, redesigning whole frames, or several alternatives, call ${SUGGEST_JOB_TOOL} and briefly tell the user why. Ask follow-up questions with ${ASK_QUESTIONS_TOOL} only when the request is genuinely ambiguous; the call ends your turn.`;

const SYSTEM_JOB = `${SYSTEM_COMMON}

You are running as a background job. Finish with a short summary of what you changed.`;

export function systemPromptFor(runtime: AgentRuntime): string {
  return runtime === 'interactive' ? SYSTEM_INTERACTIVE : SYSTEM_JOB;
}

/** Tools for a runtime, sorted by name (cache-stable). */
export function toolsForPrefix(runtime: AgentRuntime): Anthropic.Tool[] {
  const defs = [...contractToolDefs(runtime)];
  if (runtime === 'interactive') defs.push(suggestJobDef, askQuestionsDef);
  return defs
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(
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
