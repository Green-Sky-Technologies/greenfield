/** Save figcraft-cli's MCP tool list (names, descriptions, JSON schemas) to mcp-tools.json. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPIKE_DIR, startFigcraft } from './figcraft/mcp';

const fc = await startFigcraft();
const { tools } = await fc.client.listTools();
const info = fc.client.getServerVersion();
// list_commands returns a text catalog: a header line, then one line per command.
const commands = await fc.json<string>('list_commands', {});
const count = Number(/^(\d+) commands/.exec(commands)?.[1] ?? NaN);
writeFileSync(
  join(SPIKE_DIR, 'mcp-tools.json'),
  JSON.stringify({ server: info, commandCount: count, tools }, null, 2) + '\n',
);
writeFileSync(join(SPIKE_DIR, 'commands.txt'), commands + '\n');
console.log(`${tools.length} tools, ${count} commands:`);
for (const t of tools) console.log(`- ${t.name}: ${(t.description ?? '').slice(0, 100)}`);
await fc.close();
