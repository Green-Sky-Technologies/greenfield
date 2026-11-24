/** Shared pieces for both arms: golden cases, usage metering, metrics shape and scope checks. */
import type Anthropic from '@anthropic-ai/sdk';
import {
  emptyUsage,
  estimateCostMicros,
  mergeUsage,
  type ModelGateway,
  type UsageTotals,
} from '@crunch/agent';
// The eval harness isn't exported from @crunch/agent's entry; reuse its case schema and loader.
import { loadGoldenCases } from '../../../packages/agent/src/evals/cli';
import type { GoldenCase } from '../../../packages/agent/src/evals/harness';

export type { GoldenCase };
export const loadCases = (): GoldenCase[] => loadGoldenCases();

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheWrite1hTokens: number;
  estCostMicros: number;
}

/** Wrap a gateway to sum usage over every model call in a turn and count the calls. */
export function metering(gateway: ModelGateway, model: string) {
  let u: UsageTotals = emptyUsage();
  let calls = 0;
  const wrapped: ModelGateway = async (params, opts) => {
    const m: Anthropic.Message = await gateway(params, opts);
    calls++;
    const d = mergeUsage(emptyUsage(), m.usage);
    u = {
      ...u,
      inputTokens: u.inputTokens + d.inputTokens,
      outputTokens: u.outputTokens + d.outputTokens,
      cacheReadTokens: u.cacheReadTokens + d.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens + d.cacheWriteTokens,
      cacheWrite1hTokens: u.cacheWrite1hTokens + d.cacheWrite1hTokens,
    };
    return m;
  };
  return {
    wrapped,
    calls: () => calls,
    usage: (): Usage => {
      const { stopReason: _s, ...rest } = u;
      return { ...rest, estCostMicros: estimateCostMicros(model, u) };
    },
  };
}

export interface ArmMetrics {
  arm: 'figcraft' | 'html';
  variant: string;
  caseId: string;
  model: string;
  route: string;
  passed: boolean;
  failures: string[];
  /** Touched nodes as HTML-fixture ids (FigCraft layers mapped by name; new layers as new:<id>). */
  touched: string[];
  /** Committed edit transactions (FigCraft: successful mutating tool calls; each batch = 1). */
  transactions: number;
  /** Model calls in the turn. */
  turns: number;
  toolCalls: number;
  jobSuggestion: string | null;
  stopReason: string | null;
  usage: Usage;
  wallMs: number;
  finalText: string;
  /** FigCraft arm: mutating commands issued (batch steps flattened), for the report. */
  commands?: unknown[];
  notes?: string[];
}

export interface CheckInput {
  expect: GoldenCase['expect'];
  touched: string[];
  /** Is touched node `id` inside the subtree of fixture node `root` (created nodes included)? */
  within: (id: string, root: string) => boolean;
  transactions: number;
  jobSuggestion: string | null;
  usage: Usage;
  /** Off-system findings on touched nodes (lintClean); null when the arm can't check. */
  lint: string[] | null;
}

/** The golden `expect` assertions, applied the same way to both arms (mirrors harness.ts). */
export function checkExpect(c: CheckInput): string[] {
  const e = c.expect;
  const failures: string[] = [];
  if (e.noEdits && c.transactions)
    failures.push(`expected no edits, got ${c.transactions} transaction(s)`);
  if (e.touchWithin) {
    const outside = c.touched.filter((id) => !e.touchWithin!.some((r) => c.within(id, r)));
    if (outside.length)
      failures.push(
        `patch scope: touched outside ${e.touchWithin.join(', ')}: ${outside.join(', ')}`,
      );
  }
  for (const id of e.mustTouch ?? [])
    if (!c.touched.includes(id)) failures.push(`expected ${id} to be edited`);
  if (e.maxTouched !== undefined && c.touched.length > e.maxTouched)
    failures.push(`touched ${c.touched.length} nodes (max ${e.maxTouched})`);
  if (e.jobSuggestion !== undefined && c.jobSuggestion !== e.jobSuggestion)
    failures.push(`job suggestion: expected ${e.jobSuggestion}, got ${c.jobSuggestion}`);
  if (e.lintClean && c.lint?.length) failures.push(`lint: ${c.lint.join(', ')}`);
  const input = c.usage.inputTokens + c.usage.cacheReadTokens + c.usage.cacheWriteTokens;
  if (e.maxInputTokens !== undefined && input > e.maxInputTokens)
    failures.push(`input tokens ${input} > budget ${e.maxInputTokens}`);
  if (e.maxOutputTokens !== undefined && c.usage.outputTokens > e.maxOutputTokens)
    failures.push(`output tokens ${c.usage.outputTokens} > budget ${e.maxOutputTokens}`);
  return failures;
}

export function assistantText(turns: Anthropic.MessageParam[]): string {
  return turns
    .filter((t) => t.role === 'assistant' && typeof t.content !== 'string')
    .flatMap((t) => t.content as Anthropic.ContentBlockParam[])
    .map((b) => (b.type === 'text' ? b.text : ''))
    .filter(Boolean)
    .join('\n');
}

/** Replace base64 image payloads in a transcript with a short marker (keeps files small). */
export function stripImages<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (k, v) =>
      k === 'data' && typeof v === 'string' && v.length > 200 ? `<${v.length} b64 chars>` : v,
    ),
  ) as T;
}
