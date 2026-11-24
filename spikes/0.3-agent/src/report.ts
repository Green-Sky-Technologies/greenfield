/** Generate <out>/REPORT.md from the per-case metrics.json files: summary + side-by-side renders. */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArmMetrics } from './common';

interface CaseMetrics {
  case: string;
  prompt: string;
  figcraft: ArmMetrics | null;
  html: ArmMetrics | null;
}

const METHOD = `<details><summary>Method, adaptations and fixture gaps</summary>

- **Cases**: \`evals/golden/interactive.json\` (6 prompts on the \`landing\` fixture), same prompt text,
  selection and scope for both arms.
- **HTML arm**: the current interactive agent run as \`packages/agent/src/evals/harness.ts\` does
  (prefix, turn context, memory host with scope enforcement), rendered with \`@crunch/renderer\`'s
  static HTML in headless Chromium at 1280 px.
- **FigCraft arm**: headless \`figcraft-cli mcp\` (v0.18.1), fixture rebuilt with one \`batch\`
  (\`spikes/0.3-agent/src/figcraft/fixture.ts\`); each layer is named after its HTML node id. Same
  request shape (adaptive thinking, medium effort, cached prefix, automatic conversation
  breakpoint) and the same \`suggest_generation_job\` tool. Render = the \`screenshot\` tool (CPU
  renderer); \`ui.render\` is browser-only.
- **Touched layers** (FigCraft): layers named in mutating command params, plus a document diff
  that ignores layout-derived geometry (x/y, and width/height on hug/fill axes). Button label
  layers count as their button (the HTML Button is one instance node). Scoped requests are
  enforced like the HTML host: an out-of-scope edit is undone and returned as a tool error.
- **lintClean** (FigCraft): no ds-lint for layers, so touched layers are checked for off-token
  values (colours, font sizes, radii, gap/padding not in the token scales given in the prompt).
- **Not comparable**: the HTML agent also has \`create_slider\` and \`ask_questions\`; the FigCraft
  arm has neither (density-slider can only be an edit there).
- **Fixture gaps**: tokens are literal values (no variables/styles); the Button is a plain
  auto-layout frame, not a component instance; no responsive breakpoints (desktop/lg only);
  no semantic tags; \`ch\` max-widths approximated in px; grid cards hug instead of stretching
  to equal height; Inter isn't installed, so both arms fall back to SF Pro (Chromium picks the
  SF Text/Display optical size, so wrapping differs slightly).
</details>`;

const usd = (micros: number) => `$${(micros / 1e6).toFixed(4)}`;
const sum = (ms: ArmMetrics[], f: (m: ArmMetrics) => number) => ms.reduce((a, m) => a + f(m), 0);

function row(label: string, ms: ArmMetrics[]) {
  if (!ms.length) return `| ${label} | – | | | | | | | |`;
  return `| ${label} | ${ms.filter((m) => m.passed).length}/${ms.length} | ${sum(ms, (m) => m.usage.inputTokens)} | ${sum(ms, (m) => m.usage.cacheReadTokens)} | ${sum(ms, (m) => m.usage.cacheWriteTokens)} | ${sum(ms, (m) => m.usage.outputTokens)} | ${usd(sum(ms, (m) => m.usage.estCostMicros))} | ${(sum(ms, (m) => m.turns) / ms.length).toFixed(1)} | ${(sum(ms, (m) => m.wallMs) / ms.length / 1000).toFixed(1)} s |`;
}

function caseRow(label: string, m: ArmMetrics | null) {
  if (!m) return `| ${label} | – | | | | | | | |`;
  const u = m.usage;
  return `| ${label} | ${m.passed ? 'pass' : `**fail**: ${m.failures.join('; ').replace(/\|/g, '\\|')}`} | ${m.turns} | ${u.inputTokens} | ${u.cacheReadTokens} | ${u.cacheWriteTokens} | ${u.outputTokens} | ${(m.wallMs / 1000).toFixed(1)} s | ${m.touched.join(', ') || '–'}${m.jobSuggestion ? ` · job: ${m.jobSuggestion}` : ''} |`;
}

export function writeReport(outDir: string) {
  const variants = readdirSync(outDir)
    .filter((d) => d !== 'html-frame' && statSync(join(outDir, d)).isDirectory())
    .sort();
  const byVariant = new Map<string, CaseMetrics[]>();
  for (const v of variants) {
    const cases = readdirSync(join(outDir, v))
      .filter((c) => existsSync(join(outDir, v, c, 'metrics.json')))
      .sort()
      .map(
        (c) => JSON.parse(readFileSync(join(outDir, v, c, 'metrics.json'), 'utf8')) as CaseMetrics,
      );
    if (cases.length) byVariant.set(v, cases);
  }
  const all = [...byVariant.values()].flat();
  const htmlByCase = new Map(all.filter((c) => c.html).map((c) => [c.case, c.html!]));
  const first = all.find((c) => c.figcraft ?? c.html);
  const model = first?.figcraft?.model ?? first?.html?.model ?? '?';
  const route = first?.figcraft?.route ?? first?.html?.route ?? '?';

  const L: string[] = [];
  L.push('# Story 0.3: can Claude draw? FigCraft commands vs HTML frames');
  L.push('');
  L.push(
    `Model \`${model}\` via ${route}, same model for both arms. Generated ${new Date().toISOString()}.`,
  );
  if (route === 'scripted')
    L.push(
      '',
      '> **Scripted run**: canned model turns, no network. Proves the pipeline only; says nothing about quality.',
    );
  L.push('');
  L.push('## Summary');
  L.push('');
  L.push('Tokens are totals over the 6 cases; turns and wall time are per-case means.');
  L.push('');
  L.push(
    '| Arm / variant | Pass | Input (uncached) | Cache read | Cache write | Output | Est. cost | Turns | Wall |',
  );
  L.push('|---|---|---|---|---|---|---|---|---|');
  L.push(row('HTML frame (current agent)', [...htmlByCase.values()]));
  for (const [v, cs] of byVariant)
    L.push(
      row(
        `FigCraft \`${v}\``,
        cs.map((c) => c.figcraft).filter((m): m is ArmMetrics => !!m),
      ),
    );
  L.push('');
  L.push(METHOD);
  L.push('');
  const caseIds = [...new Set(all.map((c) => c.case))];
  for (const id of caseIds) {
    const entries = [...byVariant].map(([v, cs]) => [v, cs.find((c) => c.case === id)] as const);
    const prompt = entries.find(([, c]) => c)?.[1]?.prompt ?? '';
    L.push(`## ${id}`);
    L.push('');
    L.push(`> ${prompt}`);
    L.push('');
    L.push('| Arm | Result | Turns | In | Cache r | Cache w | Out | Wall | Touched |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    L.push(caseRow('HTML frame', htmlByCase.get(id) ?? null));
    for (const [v, c] of entries) if (c) L.push(caseRow(`FigCraft \`${v}\``, c.figcraft));
    L.push('');
    const shown = entries.filter(([, c]) => c);
    const htmlPng = shown
      .map(([v]) => `${v}/${id}/html.png`)
      .find((p) => existsSync(join(outDir, p)));
    L.push(`| HTML frame | ${shown.map(([v]) => `FigCraft \`${v}\``).join(' | ')} |`);
    L.push(`|---|${shown.map(() => '---').join('|')}|`);
    L.push(
      `| ${htmlPng ? `![html](${htmlPng})` : '–'} | ${shown.map(([v]) => `![${v}](${v}/${id}/figcraft.png)`).join(' | ')} |`,
    );
    L.push('');
    for (const [v, c] of shown) {
      const f = c!.figcraft;
      if (!f) continue;
      L.push(`<details><summary>FigCraft <code>${v}</code>: reply and commands</summary>`);
      L.push('');
      L.push('```json');
      L.push(JSON.stringify({ reply: f.finalText, commands: f.commands, notes: f.notes }, null, 1));
      L.push('```');
      L.push('</details>');
      L.push('');
    }
    const h = htmlByCase.get(id);
    if (h) {
      L.push('<details><summary>HTML frame: reply and patches</summary>');
      L.push('');
      L.push('```json');
      L.push(JSON.stringify({ reply: h.finalText, commits: h.commands, notes: h.notes }, null, 1));
      L.push('```');
      L.push('</details>');
      L.push('');
    }
  }
  writeFileSync(join(outDir, 'REPORT.md'), L.join('\n') + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const dir = resolve(process.argv[2] ?? join(fileURLToPath(import.meta.url), '../../out'));
  writeReport(dir);
  console.log(`wrote ${join(dir, 'REPORT.md')}`);
}
