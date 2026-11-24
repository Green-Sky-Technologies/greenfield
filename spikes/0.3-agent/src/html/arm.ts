/**
 * HTML-frame arm: the current interactive agent, run exactly as packages/agent/src/evals/harness.ts
 * runCase does (same prefix, turn context, memory host, scope, loop and limits), but keeping the
 * final DesignDoc and transcript so the result can be rendered.
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  buildPrefix,
  buildTurnContext,
  memoryHost,
  runAgentTurn,
  type ModelGateway,
} from '@greenfield/agent';
import { sampleLandingDoc, starterDesignSystem, type DesignDoc } from '@greenfield/doc-model';
import { lintDoc } from '@greenfield/ds-lint';
import { assistantText, checkExpect, metering, type ArmMetrics, type GoldenCase } from '../common';
import { renderDocPng } from './render';

export interface HtmlRun {
  metrics: ArmMetrics;
  png: Buffer;
  transcript: unknown;
}

function within(before: DesignDoc, after: DesignDoc) {
  return (id: string, root: string) => {
    // Walk up the final doc (covers nodes the agent created), else the original doc.
    let cur = after.nodes[id] ?? before.nodes[id];
    while (cur) {
      if (cur.id === root) return true;
      cur = cur.parentId ? (after.nodes[cur.parentId] ?? before.nodes[cur.parentId]) : undefined;
    }
    return false;
  };
}

export async function runHtmlCase(
  c: GoldenCase,
  o: { gateway: ModelGateway; model: string; route: string },
): Promise<HtmlRun> {
  const doc = sampleLandingDoc();
  const ds = starterDesignSystem();
  const scoped = c.scopeNodeId ? { rootNodeId: c.scopeNodeId, allowWider: false } : undefined;
  const host = memoryHost(doc, ds, { scope: scoped, maxOpsPerPatch: 200 });
  const userTurn: Anthropic.MessageParam = {
    role: 'user',
    content: [
      {
        type: 'text',
        text: buildTurnContext(
          doc,
          c.scopeNodeId ? { scopeNodeId: c.scopeNodeId } : { selection: c.selection },
        ),
      },
      { type: 'text', text: c.prompt },
    ],
  };
  const meter = metering(o.gateway, o.model);
  const prefix = buildPrefix('interactive', ds, '5m');
  const t0 = performance.now();
  let result: Awaited<ReturnType<typeof runAgentTurn>> | null = null;
  const failures: string[] = [];
  try {
    result = await runAgentTurn({
      gateway: meter.wrapped,
      model: o.model,
      prefix,
      history: [],
      userTurn,
      host,
      maxIterations: c.expect.maxIterations ?? 10,
    });
  } catch (e) {
    failures.push(`turn failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const wallMs = Math.round(performance.now() - t0);
  const touched = result?.touched ?? [];
  const usage = meter.usage();
  const lint = touched.length
    ? lintDoc(host.doc, ds, { nodeIds: touched.filter((id) => host.doc.nodes[id]) })
        .filter((i) => i.severity === 'error')
        .map((i) => `${i.code}@${i.nodeId ?? '?'}`)
    : [];
  failures.push(
    ...checkExpect({
      expect: c.expect,
      touched,
      within: within(doc, host.doc),
      transactions: host.commits.length,
      jobSuggestion: result?.jobSuggestion?.kind ?? null,
      usage,
      lint,
    }),
  );
  const turns = result?.turns ?? [];
  const { png, html } = await renderDocPng(host.doc, ds);
  const metrics: ArmMetrics = {
    arm: 'html',
    variant: 'html-frame',
    caseId: c.id,
    model: o.model,
    route: o.route,
    passed: failures.length === 0,
    failures,
    touched,
    transactions: host.commits.length,
    turns: meter.calls(),
    toolCalls: turns.flatMap((t) =>
      typeof t.content === 'string' ? [] : t.content.filter((b) => b.type === 'tool_use'),
    ).length,
    jobSuggestion: result?.jobSuggestion?.kind ?? null,
    stopReason: result?.stopReason ?? null,
    usage,
    wallMs,
    finalText: assistantText(turns),
    commands: host.commits,
    ...(result?.questions ? { notes: ['turn ended on ask_questions'] } : {}),
  };
  return {
    metrics,
    png,
    transcript: { system: prefix.system, userTurn, turns, commits: host.commits, html },
  };
}
