/**
 * Serve the editor and the bridge host page: `pnpm --filter @greenfield/bridge serve [--port N]`.
 * Default port 3103. Used as the bridge suite's Playwright `webServer`.
 */
import { DEFAULT_PORT, startHostServer } from './server';

const i = process.argv.indexOf('--port');
const port = i >= 0 ? Number(process.argv[i + 1]) : Number(process.env.BRIDGE_PORT ?? DEFAULT_PORT);
const server = await startHostServer({ port });
console.log(`bridge host: ${server.url}/__bridge/host.html (editor at ${server.url}/editor/)`);
const stop = () => void server.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
