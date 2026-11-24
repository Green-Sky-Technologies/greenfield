/**
 * Generate `src/generated/commands.ts` from the pinned editor (Story 1.3).
 *
 *   pnpm --filter @greenfield/bridge generate         # write the file
 *   pnpm --filter @greenfield/bridge check:commands   # regenerate in memory; fail on a mismatch
 *
 * Loads the release in `apps/web/public/editor` (run `node spikes/0.1-embed/fetch-editor.mjs`
 * first) in headless Chromium, reads `figcraft.commands()`, asks the engine which parameters each
 * command takes (an unknown parameter is rejected before anything runs, with the list), and reads
 * the node field names the same way. Serves on port 3103 (`BRIDGE_PORT` to change), or reuses a
 * server already there that serves the same editor.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import prettier from 'prettier';
import {
  generateModule,
  hashCommands,
  parseFieldKeys,
  parseTakes,
  type CommandMeta,
} from './command-types';
import { DEFAULT_PORT, editorStamp, startHostServer } from '../src/playwright/server';

const OUT = fileURLToPath(new URL('../src/generated/commands.ts', import.meta.url));
const check = process.argv.includes('--check');
const port = Number(process.env.BRIDGE_PORT ?? DEFAULT_PORT);

const stamp = editorStamp();
if (!stamp) {
  console.error(
    'No pinned editor in apps/web/public/editor. Run: node spikes/0.1-embed/fetch-editor.mjs',
  );
  process.exit(1);
}
const [editorVersion, editorSha256] = stamp.split(/\s+/) as [string, string];

/** Our own server, or one already on the port that serves the same editor. */
async function serve(): Promise<{ url: string; close(): Promise<void> }> {
  try {
    return await startHostServer({ port });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    const url = `http://127.0.0.1:${port}`;
    const r = await fetch(`${url}/editor/.figcraft-version`).catch(() => null);
    if (r?.ok && (await r.text()).trim() === stamp) return { url, close: async () => {} };
    throw new Error(`Port ${port} is in use by something else; set BRIDGE_PORT.`, { cause: e });
  }
}

interface Probe {
  commands: CommandMeta[];
  takes: Record<string, string[]>;
  failures: Record<string, string>;
  fieldsError: string;
}

const server = await serve();
const browser = await chromium.launch();
let probe: Probe;
try {
  // The command list (shortcut labels included) doesn't depend on the user agent or platform:
  // checked with Mac, Linux and Windows user agents.
  const page = await browser.newPage();
  // tsx compiles with esbuild's keepNames, which references `__name` inside evaluated functions.
  await page.addInitScript('window.__name = (f) => f');
  await page.goto(`${server.url}/editor/index.html?control&webgl`);
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { figcraft?: { execute?: unknown } }).figcraft?.execute ===
      'function',
    undefined,
    { timeout: 60_000 },
  );
  probe = await page.evaluate(async () => {
    type F = {
      commands(): Promise<CommandMeta[]>;
      execute(c: string, p: unknown): Promise<{ id?: number }>;
      docInspect(p: unknown): Promise<unknown>;
    };
    const f = (window as unknown as { figcraft: F }).figcraft;
    const commands = await f.commands();
    await f.execute('file.new', {});
    const frame = await f.execute('node.create', { type: 'frame' });
    const takes: Record<string, string> = {};
    const failures: Record<string, string> = {};
    const message = (e: unknown) => String((e as Error)?.message ?? e);
    for (const c of commands) {
      // An unknown parameter is refused before the command runs, naming the ones it takes.
      const params = c.id === 'node.set' ? { ids: [frame.id], __probe__: 1 } : { __probe__: 1 };
      try {
        await Promise.race([
          f.execute(c.id, params),
          new Promise((_, no) => setTimeout(() => no(new Error('probe timed out')), 5000)),
        ]);
        failures[c.id] = 'accepted an unknown parameter';
      } catch (e) {
        takes[c.id] = message(e);
      }
    }
    let fieldsError = '';
    await f.docInspect({ fields: ['__probe__'] }).catch((e: unknown) => (fieldsError = message(e)));
    return { commands, takes: takes as unknown as Record<string, string[]>, failures, fieldsError };
  });
} finally {
  await browser.close();
  await server.close();
}

// Messages → key lists (node.set reports unknown *properties*; it takes ids, id, props + props).
const takes: Record<string, string[]> = {};
for (const [id, msg] of Object.entries(probe.takes as unknown as Record<string, string>)) {
  const keys = id === 'node.set' ? ['ids', 'id', 'props'] : parseTakes(msg);
  if (keys) takes[id] = keys;
  else probe.failures[id] = msg;
}
const nodeFields = parseFieldKeys(probe.fieldsError);
if (!nodeFields) throw new Error(`Couldn't read the node field names: ${probe.fieldsError}`);

const { source, stats } = generateModule({
  editorVersion,
  editorSha256,
  commands: probe.commands,
  takes,
  nodeFields,
});
const config = await prettier.resolveConfig(OUT);
const formatted = await prettier.format(source, { ...config, filepath: OUT });
const hash = hashCommands(probe.commands);

console.log(
  `figcraft-web ${editorVersion}: ${stats.commands} commands, hash ${hash.slice(0, 12)}…\n` +
    `  exact key lists: ${stats.exactKeys}, fallback (Record<string, unknown>): ${stats.fallback}\n` +
    `  params typed: ${stats.typedParams}, unknown: ${stats.unknownParams}\n` +
    `  node.set props typed: ${stats.typedProps}, unknown: ${stats.unknownProps}`,
);
for (const [id, why] of Object.entries(probe.failures))
  console.warn(`  no key list for ${id}: ${why}`);

if (check) {
  let committed = '';
  try {
    committed = readFileSync(OUT, 'utf8');
  } catch {
    // reported below
  }
  const committedHash = /COMMANDS_HASH = '([0-9a-f]+)'/.exec(committed)?.[1];
  const committedVersion = /EDITOR_VERSION = '([^']+)'/.exec(committed)?.[1];
  if (committedHash !== hash || committedVersion !== editorVersion) {
    console.error(
      `\nThe pinned editor's commands changed (committed ${committedVersion ?? '-'} ` +
        `${committedHash?.slice(0, 12) ?? '-'}…, editor ${editorVersion} ${hash.slice(0, 12)}…).\n` +
        'Run `pnpm --filter @greenfield/bridge generate` and commit src/generated/commands.ts.',
    );
    process.exit(1);
  }
  if (committed !== formatted) {
    console.error(
      '\nsrc/generated/commands.ts is out of date with the generator. ' +
        'Run `pnpm --filter @greenfield/bridge generate` and commit it.',
    );
    process.exit(1);
  }
  console.log('check:commands ok');
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, formatted);
  console.log(`wrote ${OUT}`);
}
