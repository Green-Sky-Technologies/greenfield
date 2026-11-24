/**
 * Story 0.3 eval runner. Real run (billed; one command):
 *
 *   AI_GATEWAY_API_KEY=… pnpm --filter spike-0.3-agent eval            # or ANTHROPIC_API_KEY=…
 *
 * Options:
 *   --scripted              canned model turns, no network (pipeline self-check)
 *   --arm both|figcraft|html  (default both; the HTML arm runs once per case and is reused by
 *                           every variant unless --arm html or --rerun-html)
 *   --variant <preset>      v1 (default), v1-auto-render, v1-no-render, run-command, curated,
 *                           full-catalog, minimal
 *   --prompt base|full-catalog|minimal  --tools batch|run_command|curated
 *   --render tool|auto|none  --context subtree|outline   (override one axis of the preset)
 *   --case <id>             repeatable; default all six golden cases
 *   --model <id>            default MODEL_TIERS.interactive (same model for both arms)
 *   --parallel <n>          cases run concurrently (default 1)
 *   --out <dir>             default out/ (scripted: out-scripted/)
 *
 * Writes <out>/<variant>/<case>/{figcraft.png,html.png,metrics.json,transcript.json,final.figcraft}
 * and regenerates <out>/REPORT.md.
 */
import { MODEL_TIERS } from '@greenfield/providers';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadCases, stripImages, type ArmMetrics, type GoldenCase } from './common';
import { runFigcraftCase } from './figcraft/arm';
import { SPIKE_DIR } from './figcraft/mcp';
import { resolveVariant, type Variant } from './figcraft/variants';
import { runHtmlCase } from './html/arm';
import { closeBrowser } from './html/render';
import { liveRoute, withWireModel, type ModelRoute } from './model';
import { writeReport } from './report';
import { figcraftScript, htmlScript, lazyScripted } from './scripted';

function parse(argv: string[]) {
  const o = {
    scripted: false,
    arm: 'both' as 'both' | 'figcraft' | 'html',
    variant: undefined as string | undefined,
    overrides: {} as Partial<Omit<Variant, 'name'>>,
    cases: [] as string[],
    model: MODEL_TIERS.interactive as string,
    parallel: 1,
    out: undefined as string | undefined,
    rerunHtml: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i]!;
    if (a === '--') continue;
    else if (a === '--scripted') o.scripted = true;
    else if (a === '--arm') o.arm = next() as typeof o.arm;
    else if (a === '--variant') o.variant = next();
    else if (a === '--prompt') o.overrides.prompt = next() as Variant['prompt'];
    else if (a === '--tools') o.overrides.tools = next() as Variant['tools'];
    else if (a === '--render') o.overrides.render = next() as Variant['render'];
    else if (a === '--context') o.overrides.context = next() as Variant['context'];
    else if (a === '--case') o.cases.push(next());
    else if (a === '--model') o.model = next();
    else if (a === '--parallel') o.parallel = Math.max(1, Number(next()));
    else if (a === '--out') o.out = next();
    else if (a === '--rerun-html') o.rerunHtml = true;
    else throw new Error(`Unknown option ${a}`);
  }
  return o;
}

const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

async function pool<T>(items: T[], n: number, f: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (let t = queue.shift(); t !== undefined; t = queue.shift()) await f(t);
    }),
  );
}

async function main() {
  const o = parse(process.argv.slice(2));
  const outDir = resolve(SPIKE_DIR, o.out ?? (o.scripted ? 'out-scripted' : 'out'));
  const variant = resolveVariant(o.variant, o.overrides);
  const cases = loadCases().filter((c) => !o.cases.length || o.cases.includes(c.id));
  if (!cases.length) throw new Error('No matching cases');
  const live: ModelRoute | null = o.scripted ? null : await liveRoute(o.model);
  const route = live?.route ?? 'scripted';
  console.log(
    `model ${o.model} via ${route}; variant ${variant.name}; ${cases.length} case(s) -> ${outDir}`,
  );

  const runHtml = async (c: GoldenCase) => {
    const dir = join(outDir, 'html-frame', c.id);
    if (
      o.arm === 'figcraft' ||
      (o.arm === 'both' && !o.rerunHtml && existsSync(join(dir, 'metrics.json')))
    )
      return;
    mkdirSync(dir, { recursive: true });
    const gateway = live ? withWireModel(live) : lazyScripted(() => htmlScript(c.id));
    const r = await runHtmlCase(c, { gateway, model: o.model, route });
    writeFileSync(join(dir, 'html.png'), r.png);
    writeJson(join(dir, 'metrics.json'), r.metrics);
    writeJson(join(dir, 'transcript.json'), stripImages(r.transcript));
    log(r.metrics);
  };

  const runFig = async (c: GoldenCase) => {
    if (o.arm === 'html') return;
    const dir = join(outDir, variant.name, c.id);
    mkdirSync(dir, { recursive: true });
    let gateway = live ? withWireModel(live) : null;
    let fxIds: Parameters<typeof figcraftScript>[1] | null = null;
    gateway ??= lazyScripted(() => figcraftScript(c.id, fxIds!));
    const r = await runFigcraftCase(c, {
      gateway,
      model: o.model,
      route,
      variant,
      saveTo: join(dir, 'final.figcraft'),
      onFixture: (fx) => (fxIds = fx),
    });
    writeFileSync(join(dir, 'figcraft.png'), r.png);
    writeJson(join(dir, 'transcript.json'), stripImages(r.transcript));
    writeJson(join(dir, 'figcraft-metrics.json'), r.metrics);
    log(r.metrics);
  };

  await pool(cases, o.parallel, async (c) => {
    await runHtml(c);
    await runFig(c);
  });
  await closeBrowser();

  // Assemble per-variant case folders: figcraft + the shared HTML-arm result side by side.
  for (const c of cases) {
    if (o.arm === 'html') continue;
    const dir = join(outDir, variant.name, c.id);
    const htmlDir = join(outDir, 'html-frame', c.id);
    const read = (p: string) =>
      existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as ArmMetrics) : null;
    if (existsSync(join(htmlDir, 'html.png')))
      copyFileSync(join(htmlDir, 'html.png'), join(dir, 'html.png'));
    writeJson(join(dir, 'metrics.json'), {
      case: c.id,
      prompt: c.prompt,
      figcraft: read(join(dir, 'figcraft-metrics.json')),
      html: read(join(htmlDir, 'metrics.json')),
    });
  }
  writeReport(outDir);
  console.log(`report: ${join(outDir, 'REPORT.md')}`);
}

function log(m: ArmMetrics) {
  const u = m.usage;
  console.log(
    `${m.passed ? 'PASS' : 'FAIL'} ${m.arm.padEnd(8)} ${m.caseId.padEnd(24)} turns ${m.turns} in ${u.inputTokens} / cache r ${u.cacheReadTokens} w ${u.cacheWriteTokens} / out ${u.outputTokens}  ${m.wallMs} ms${m.passed ? '' : `  — ${m.failures.join('; ')}`}`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
