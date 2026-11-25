# @greenfield/sandbox-runner

`JobRunner` on Vercel Sandbox (Story 5.1), plus the program that runs inside each job sandbox.
The sandbox gets only an allowlisted env: the LLM proxy URL (`ANTHROPIC_BASE_URL`) and a
short-lived job token. Provider credentials never enter it (SPEC D9).

## Deployment configuration (apps/web)

| Env var                           | Needed for         | Notes                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CRON_SECRET`                     | `/api/jobs/reap`   | Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. `apps/web/vercel.json` schedules it every minute. Without it the endpoint returns 401, so timeouts, orphaned sandboxes and lost starts aren't handled. Per-minute crons need a Pro plan; Hobby allows daily crons only.                                                                       |
| `GREENFIELD_APP_URL`              | sandbox callbacks  | Public base URL the sandbox calls (`/api/llm`, `/api/jobs/:id/...`). If unset: `VERCEL_PROJECT_PRODUCTION_URL` in production, `VERCEL_URL` in previews (a preview never calls back to production), `localhost:$PORT` locally.                                                                                                                         |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | protected previews | With Deployment Protection on, the sandbox can't reach a preview. Set this to the project's "Protection Bypass for Automation" secret. The runner then has the sandbox **egress firewall** add `x-vercel-protection-bypass` to requests for the app host only. The secret is never put in the VM's env or files. Don't disable Deployment Protection. |
| Vercel Sandbox auth               | creating sandboxes | Automatic via OIDC on Vercel. Locally: `vercel env pull` (`VERCEL_OIDC_TOKEN`), or `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`.                                                                                                                                                                                                           |

Egress from the sandbox is limited to the app host, `registry.npmjs.org` and the host of the
pinned `figcraft-cli` (GitHub release downloads). Use `allowHosts` if the Agent SDK needs more.

Agent jobs (Story 4.5) run headless `figcraft-cli` (Linux x86_64, from the fork's release, pinned
by sha256 as `cli: { url, sha256 }` in `packages/bridge/editor-release.json`, or
`GREENFIELD_FIGCRAFT_CLI_URL` / `GREENFIELD_FIGCRAFT_CLI_SHA256`) confined to the job folder with
`--automation-read-root` / `--automation-write-root` (Story 4.6). `FIGCRAFT_CLI=<path> pnpm test`
also runs `entrypoint.test.ts` against a real CLI, including the confinement tests.
