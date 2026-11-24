/**
 * Model access for both arms, through @greenfield/providers. Credentials come from the environment
 * only and are never logged:
 *   AI_GATEWAY_API_KEY  -> Vercel AI Gateway (buildGatewayClient, model id via providerModelId)
 *   VERCEL_OIDC_TOKEN   -> Vercel AI Gateway with the OIDC token (used if no gateway key)
 *   ANTHROPIC_API_KEY   -> Anthropic API (buildClient)
 * `--scripted` swaps in canned responses (no network at all).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { buildClient, buildGatewayClient, providerModelId } from '@greenfield/providers';
import type { ModelGateway } from '@greenfield/agent';

export interface ModelRoute {
  /** What the run is billed against, for the report (never the secret). */
  route: 'gateway' | 'gateway-oidc' | 'anthropic' | 'scripted';
  /** First-party model id (MODEL_TIERS.*); the wire id is derived per route. */
  model: string;
  wireModel: string;
  gateway: ModelGateway;
}

function streamingGateway(client: Anthropic): ModelGateway {
  return async (params, opts) => {
    const stream = client.messages.stream(params, { signal: opts.signal });
    for await (const e of stream) opts.onEvent?.(e);
    return stream.finalMessage();
  };
}

export async function liveRoute(model: string): Promise<ModelRoute> {
  const env = process.env;
  if (env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN) {
    const key = env.AI_GATEWAY_API_KEY;
    const client = buildGatewayClient(key ?? (async () => process.env.VERCEL_OIDC_TOKEN!));
    return {
      route: key ? 'gateway' : 'gateway-oidc',
      model,
      wireModel: providerModelId('gateway', model),
      gateway: streamingGateway(client),
    };
  }
  if (env.ANTHROPIC_API_KEY) {
    const client = (await buildClient(
      { provider: 'anthropic' },
      { provider: 'anthropic', apiKey: env.ANTHROPIC_API_KEY },
    )) as Anthropic;
    return {
      route: 'anthropic',
      model,
      wireModel: providerModelId('anthropic', model),
      gateway: streamingGateway(client),
    };
  }
  throw new Error(
    'No credentials: set AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN) or ANTHROPIC_API_KEY, or pass --scripted.',
  );
}

/** Rewrite the model id to the route's wire id on every call (the loops speak first-party ids). */
export function withWireModel(r: ModelRoute): ModelGateway {
  return (params, opts) => r.gateway({ ...params, model: r.wireModel }, opts);
}
