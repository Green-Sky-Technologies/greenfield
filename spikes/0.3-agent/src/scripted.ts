/**
 * Canned model turns for both arms (no network). They prove the pipeline end to end: tool
 * plumbing, scope enforcement (the FigCraft button case first tries an out-of-scope edit),
 * render feedback, job hand-off, metrics and output files. They say nothing about model quality.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { SUGGEST_JOB_TOOL, type ModelGateway } from '@greenfield/agent';
import {
  scriptedGateway,
  text,
  toolUse,
  type ScriptedTurn,
} from '../../../packages/agent/src/evals/scripted';
import type { Fixture } from './figcraft/fixture';

const U = { input_tokens: 1200, output_tokens: 150, cache_read_input_tokens: 4000 };
const turn = (...content: Anthropic.ContentBlock[]): ScriptedTurn => ({ content, usage: U });
const done = (t: string) => turn(text(t));

const job = (kind: 'generate' | 'alternatives', prompt: string) =>
  turn(
    text('That is bigger than a quick edit, so I am offering a background job.'),
    toolUse('tu_job', SUGGEST_JOB_TOOL, {
      kind,
      prompt,
      reason: 'Needs new frames, not a small edit.',
      ...(kind === 'alternatives' ? { count: 3 } : {}),
    }),
  );

export function figcraftScript(caseId: string, fx: Fixture): ScriptedTurn[] {
  const id = fx.ids;
  const batch = (label: string, commands: unknown[]) =>
    toolUse(`tu_${label}`, 'batch', { label, commands });
  const render = toolUse('tu_render', 'render', {});
  switch (caseId) {
    case 'button-larger-scoped':
      return [
        // Out of scope on purpose: the harness must undo it and report an error.
        turn(
          batch('oops', [
            { command: 'node.set', params: { ids: [id.n_hero000001], props: { gap: 32 } } },
          ]),
        ),
        turn(
          batch('larger', [
            {
              command: 'node.set',
              params: { ids: [id.n_herocta001], props: { padding: [12, 24, 12, 24] } },
            },
            {
              command: 'node.set',
              params: { ids: [id.n_herocta001_label], props: { fontSize: 16 } },
            },
          ]),
        ),
        turn(render),
        done('Made the button larger: more padding and a 16px label.'),
      ];
    case 'headline-copy':
      return [
        turn(
          batch('headline', [
            {
              command: 'text.set',
              params: { id: id.n_herotitle1, characters: 'Design at the speed of thought' },
            },
          ]),
        ),
        turn(render),
        done('Updated the headline.'),
      ];
    case 'feature-cards-spacing':
    case 'density-slider': {
      const cards = [id.n_feat1card00, id.n_feat2card00, id.n_feat3card00];
      return [
        turn(
          batch('tighten', [
            { command: 'node.set', params: { ids: [id.n_features01], props: { gap: 12 } } },
            { command: 'node.set', params: { ids: cards, props: { padding: 16 } } },
          ]),
        ),
        turn(render),
        done('Tightened the feature grid gap to 12 and card padding to 16.'),
      ];
    }
    case 'pricing-page-offers-job':
      return [
        job('generate', 'A pricing page with three tiers and an FAQ.'),
        done('Offered a job.'),
      ];
    case 'alternatives-offers-job':
      return [job('alternatives', 'Three layouts of the landing page.'), done('Offered a job.')];
    default:
      return [done('No script for this case.')];
  }
}

export function htmlScript(caseId: string): ScriptedTurn[] {
  const patch = (label: string, ops: unknown[]) =>
    toolUse(`tu_${label}`, 'patch_nodes', { label, ops });
  const style = (id: string, prop: string, token: string) => ({
    op: 'setStyle',
    id,
    breakpoint: 'base',
    prop,
    value: { token },
  });
  switch (caseId) {
    case 'button-larger-scoped':
      return [
        turn(patch('larger', [style('n_herocta001', 'paddingTop', 'space.3')])),
        done('Made the button larger.'),
      ];
    case 'headline-copy':
      return [
        turn(
          patch('headline', [
            {
              op: 'setProps',
              id: 'n_herotitle1',
              patch: { text: 'Design at the speed of thought' },
            },
          ]),
        ),
        done('Updated the headline.'),
      ];
    case 'feature-cards-spacing':
    case 'density-slider':
      return [
        turn(patch('tighten', [style('n_features01', 'gap', 'space.3')])),
        done('Tightened the grid gap.'),
      ];
    case 'pricing-page-offers-job':
      return [
        job('generate', 'A pricing page with three tiers and an FAQ.'),
        done('Offered a job.'),
      ];
    case 'alternatives-offers-job':
      return [job('alternatives', 'Three layouts of the landing page.'), done('Offered a job.')];
    default:
      return [done('No script for this case.')];
  }
}

/** A gateway whose script is built on first call (the FigCraft script needs the fixture ids). */
export function lazyScripted(build: () => ScriptedTurn[]): ModelGateway {
  let g: ModelGateway | null = null;
  return (params, opts) => (g ??= scriptedGateway(build()).gateway)(params, opts);
}
