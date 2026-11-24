/**
 * Golden agent cases (`evals/golden/*.json`) and their scope checks, for replaying tool calls
 * against an editor (Story 1.4) and, later, for the eval harness (Story 4.8).
 */
import { z } from 'zod';
import { JOB_SUGGESTION_KINDS } from '../followup';

export const goldenCase = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    description: z.string(),
    fixture: z.literal('landing'),
    prompt: z.string().min(1),
    selection: z.array(z.string()).optional(),
    /** Ask-agent request scoped to this layer. */
    scopeNodeId: z.string().optional(),
    expect: z
      .object({
        /** Every touched layer must be one of these, or inside one of them. */
        touchWithin: z.array(z.string()).optional(),
        /** Each of these must be touched. */
        mustTouch: z.array(z.string()).optional(),
        maxTouched: z.number().int().positive().optional(),
        /** No edits at all (a request that should become a job). */
        noEdits: z.boolean().optional(),
        /** Expected job hand-off kind, or null for "must not suggest a job". */
        jobSuggestion: z.enum(JOB_SUGGESTION_KINDS).nullable().optional(),
        /** Design-system lint on the touched layers (not checkable yet: see evals/README.md). */
        lintClean: z.boolean().optional(),
        /** Token budgets for the whole turn (need a model run). */
        maxInputTokens: z.number().int().positive().optional(),
        maxOutputTokens: z.number().int().positive().optional(),
        maxIterations: z.number().int().positive().optional(),
      })
      .strict(),
  })
  .strict();
export type GoldenCase = z.infer<typeof goldenCase>;
export const goldenCases = z.array(goldenCase);

export interface ScopeResult {
  /** Golden names of the touched layers (`new:<id>` for layers the turn created). */
  touched: string[];
  /** Mutating tool calls in the turn. */
  edits: number;
  jobSuggestion: string | null;
  /** Is the touched layer `name` the layer `root` or inside it? */
  within(name: string, root: string): boolean;
}

/** The scope expectations that don't need a model: touched layers, edits and job hand-off. */
export function checkScope(e: GoldenCase['expect'], r: ScopeResult): string[] {
  const failures: string[] = [];
  if (e.noEdits && (r.edits || r.touched.length))
    failures.push(`expected no edits, got ${r.edits} edit(s) touching ${r.touched.join(', ')}`);
  if (e.touchWithin) {
    const outside = r.touched.filter((id) => !e.touchWithin!.some((root) => r.within(id, root)));
    if (outside.length)
      failures.push(`touched outside ${e.touchWithin.join(', ')}: ${outside.join(', ')}`);
  }
  for (const id of e.mustTouch ?? [])
    if (!r.touched.includes(id)) failures.push(`expected ${id} to be edited`);
  if (e.maxTouched !== undefined && r.touched.length > e.maxTouched)
    failures.push(`touched ${r.touched.length} layers (max ${e.maxTouched})`);
  if (e.jobSuggestion !== undefined && r.jobSuggestion !== e.jobSuggestion)
    failures.push(`job suggestion: expected ${e.jobSuggestion}, got ${r.jobSuggestion}`);
  return failures;
}
