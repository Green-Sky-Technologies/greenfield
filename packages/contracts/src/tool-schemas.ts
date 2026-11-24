/**
 * Input and output schemas of the agent's editor tools (Story 1.4). Inputs are what the model
 * sends (and what the JSON Schema in the tool definitions shows); outputs are what
 * `executeTool` returns as the tool result, validated before they go back.
 */
import { NODE_FIELDS, type EditorNode } from '@greenfield/bridge';
import { z } from 'zod';

const FIELD_SET: ReadonlySet<string> = new Set(NODE_FIELDS);

export const nodeId = z.number().int().nonnegative().describe('Layer id');

const fields = z
  .array(z.string())
  .min(1)
  .max(40)
  .superRefine((fs, ctx) => {
    const bad = fs.filter((f) => !FIELD_SET.has(f));
    if (bad.length)
      ctx.addIssue({
        code: 'custom',
        message: `unknown field ${bad.map((f) => `\`${f}\``).join(', ')}; valid fields: ${NODE_FIELDS.join(', ')}`,
      });
  })
  .describe(
    'Only these layer keys (e.g. name, type, x, y, width, height, fills, strokes, cornerRadius, layout, characters, fontFamily, fontStyle, fontSize). Omit for every key.',
  );

// ---------------------------------------------------------------- inputs

export const getSelectionInput = z
  .object({
    depth: z
      .number()
      .int()
      .min(0)
      .max(8)
      .default(2)
      .describe('Children depth below each selected layer'),
    fields: fields.optional(),
  })
  .strict();

export const getOutlineInput = z
  .object({
    root: nodeId.optional().describe('Outline below this layer instead of the whole page'),
    depth: z.number().int().min(1).max(16).default(6),
  })
  .strict();

export const getNodeInput = z
  .object({
    id: nodeId,
    depth: z.number().int().min(0).max(8).default(1).describe('Children depth'),
    fields: fields.optional(),
    outline: z
      .boolean()
      .optional()
      .describe('Only id, name, type, characters and visibility (not with fields)'),
  })
  .strict()
  .refine((v) => !(v.outline && v.fields), {
    message: '`outline` and `fields` cannot be combined',
    path: ['outline'],
  });

export const renderInput = z
  .object({
    ids: z
      .array(nodeId)
      .min(1)
      .max(20)
      .optional()
      .describe('Layers to render (default: the selection, else the page)'),
    scale: z.number().positive().max(2).default(1).describe('Keep the long side under ~1600 px'),
  })
  .strict();

export const listCommandsInput = z
  .object({
    query: z
      .string()
      .trim()
      .max(80)
      .optional()
      .describe('Words to match in command ids and labels, e.g. "align" or "text.style"'),
    limit: z.number().int().min(1).max(100).default(40),
  })
  .strict();

export const commentThreadInput = z
  .object({
    threadId: z
      .union([z.string().min(1).max(100), z.number().int()])
      .describe('The comment thread id'),
    reply: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .optional()
      .describe('Post this reply in the thread (signed as the agent)'),
  })
  .strict();

// ---------------------------------------------------------------- outputs

export const editorNode: z.ZodType<EditorNode> = z.lazy(() =>
  z
    .object({
      id: nodeId,
      name: z.string().optional(),
      type: z.string().optional(),
      children: z.array(editorNode).optional(),
      childCount: z.number().int().nonnegative().optional(),
    })
    .catchall(z.unknown()),
) as z.ZodType<EditorNode>;

export const getSelectionOutput = z
  .object({ page: nodeId, selection: z.array(editorNode) })
  .strict();

export const getOutlineOutput = z.object({ page: nodeId, outline: editorNode }).strict();

export const getNodeOutput = z.object({ node: editorNode }).strict();

export const changeSet = z
  .object({
    added: z.array(nodeId),
    removed: z.array(nodeId),
    changed: z.array(z.object({ id: nodeId, fields: z.array(z.string()) }).strict()),
  })
  .strict();
export type LayerChanges = z.infer<typeof changeSet>;

export const runBatchOutput = z
  .object({
    label: z.string(),
    /** Each step's result, in order (`node.create` → `{id}`). */
    results: z.array(z.unknown()),
    /**
     * Layers on the current page that this batch added, removed or changed; null when the
     * document couldn't be read back afterwards (the batch still applied).
     */
    changes: changeSet.nullable(),
  })
  .strict();

export const renderOutput = z
  .object({
    ids: z.array(nodeId).nullable(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
  })
  .strict();

export const listCommandsOutput = z
  .object({
    total: z.number().int().nonnegative(),
    commands: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          params: z.string(),
          undoable: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

export const commentThreadOutput = z.object({ thread: z.unknown(), replied: z.boolean() }).strict();
