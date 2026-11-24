/**
 * JSON-schema tool definitions for the model. They are generated in `@greenfield/contracts`
 * (Story 1.4) from the shared Zod schemas: sorted by name, keys sorted, byte-stable.
 */
import {
  jsonSchemaFor,
  toolDefinitions,
  toToolDefinition,
  type AgentRuntime,
  type ToolDefinition,
} from '@greenfield/contracts';

export type JsonToolDef = ToolDefinition;
export { jsonSchemaFor, toToolDefinition as toJsonToolDef };

/** Contract tools for a runtime, in toolsFor() order, as JSON-schema definitions. */
export function contractToolDefs(runtime: AgentRuntime): readonly JsonToolDef[] {
  return toolDefinitions(runtime);
}
