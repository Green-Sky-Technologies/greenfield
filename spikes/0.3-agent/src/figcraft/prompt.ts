/**
 * Cacheable prefix for the FigCraft arm: tools (from figcraft-cli's own MCP schemas, saved in
 * mcp-tools.json) and a system prompt per variant. Static text only; the document goes in the
 * user turn, as on the HTML side.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { buildPrefix, SUGGEST_JOB_TOOL } from '@greenfield/agent';
import { starterDesignSystem } from '@greenfield/doc-model';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalog, catalogLines } from './catalog';
import { TOKENS } from './fixture';
import { SPIKE_DIR } from './mcp';
import { CURATED_COMMANDS, type Variant } from './variants';

export const RENDER_TOOL = 'render';

interface McpTool {
  name: string;
  description?: string;
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; [k: string]: unknown };
}

function mcpTools(): Map<string, McpTool> {
  const raw = JSON.parse(readFileSync(join(SPIKE_DIR, 'mcp-tools.json'), 'utf8')) as {
    tools: McpTool[];
  };
  return new Map(raw.tools.map((t) => [t.name, t]));
}

/** An MCP tool as a Claude tool, minus the multi-document `document` parameter. */
function passThrough(name: string, description?: string): Anthropic.Tool {
  const t = mcpTools().get(name);
  if (!t) throw new Error(`MCP tool ${name} missing from mcp-tools.json`);
  const { document: _d, ...properties } = t.inputSchema.properties ?? {};
  return {
    name,
    description: description ?? t.description ?? '',
    input_schema: { ...t.inputSchema, properties } as Anthropic.Tool['input_schema'],
  };
}

const renderTool: Anthropic.Tool = {
  name: RENDER_TOOL,
  description:
    'Render a layer (default: the layer in scope, else the whole page frame) to a PNG and look at it. Use it to check your edit visually.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'integer', description: 'Layer id (default: scope, else the page frame)' },
      scale: { type: 'number', description: 'Scale, default 1 (max 2)' },
    },
  },
};

function suggestJobTool(): Anthropic.Tool {
  // The exact definition the HTML interactive agent gets.
  const t = buildPrefix('interactive', starterDesignSystem(), '5m').tools.find(
    (x) => x.name === SUGGEST_JOB_TOOL,
  );
  return t as Anthropic.Tool;
}

export function toolsFor(v: Variant): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [suggestJobTool()];
  const getNode = passThrough(
    'get_node',
    'Read one layer as JSON with its children to `depth`. Use `fields` or `outline: true` to keep it small.',
  );
  if (v.tools === 'batch') {
    tools.push(
      passThrough('batch'),
      passThrough(
        'run_command',
        'Run one read-only command (e.g. node.find, text.fonts, inspect.code). Make edits with batch.',
      ),
      getNode,
      passThrough('list_commands'),
    );
  } else if (v.tools === 'run_command') {
    tools.push(passThrough('run_command'), getNode, passThrough('list_commands'));
  } else {
    const b = passThrough(
      'batch',
      `Run several commands in order as ONE undo step. Allowed commands: ${CURATED_COMMANDS.join(', ')}. A step can name itself with "as" and later steps use {"$ref": name} for its result's id. The first failing step rolls back the whole batch.`,
    );
    tools.push(b, getNode);
  }
  if (v.render !== 'none') tools.push(renderTool);
  return tools.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const TOKENS_BLOCK = `<design_tokens>
Use these values; they are the design system's tokens resolved for the desktop frame.
colors: background ${TOKENS.background}, surface ${TOKENS.surface}, text ${TOKENS.text}, muted ${TOKENS.muted}, border ${TOKENS.border}, primary ${TOKENS.primary}, primaryText ${TOKENS.primaryText}, accent #F97316
space (px): 4, 8, 12, 16, 24, 32, 48, 64, 96
radius (px): 4, 8, 16, 9999 (pill)
font: SF Pro; sizes 12, 14, 16, 18, 20, 24, 36, 60; styles Regular, Medium, Semibold, Bold
line height: 115% (tight), 150% (normal)
</design_tokens>`;

const CONVENTIONS = `<editor_conventions>
- Layers have numeric ids (what commands take) and names. Each layer here is named with a stable id like n_herocta001; keep names when you edit.
- Coordinates are px, y down, relative to the parent frame. Children of an auto layout frame are positioned by the layout: change layout, gap, padding, mainAlign, crossAlign, sizingH/sizingV instead of x/y.
- Auto layout props (node.set / node.create props): layout (horizontal|vertical|grid), gap, padding (n or [t,r,b,l]), mainAlign (min|center|max|spaceBetween|spaceAround|spaceEvenly), crossAlign (min|center|max|baseline), sizingH/sizingV (fixed|hug|fill), minWidth/maxWidth, grid: gridColumns, columnTracks [120, "1fr", "auto"], columnGap/rowGap.
- Colours are "#RRGGBB" or "#RRGGBBAA". fill / stroke take a colour or "none"; fills / strokes take paint lists.
- Text props: characters (or text.set), fontFamily, fontStyle, fontSize, lineHeight ("150%"), letterSpacing, textAlign, textAutoResize (widthAndHeight|height|none).
- batch runs commands in order as ONE undo step; the first failure rolls everything back. A step named with "as" can be referenced later with {"$ref": name} (its result's id) or {"$ref": name, "field": "ids/0"}.
- New layers become the selection unless params say select: false.
</editor_conventions>`;

const BASE = `You are Greenfield's design agent. You edit a vector design document in FigCraft, a Figma-like editor, by issuing editor commands. There is no HTML or CSS: what you change is layers.

How to work:
- Change only what the request needs. Read the layers you need (the context below usually has them), then make the edit with ONE batch of commands (one undo step). Never delete and rebuild layers to change a property; set the property.
- Stay on the design system: use the token values below, not arbitrary numbers or colours.
- Stay inside the scope or selection you are given unless the request clearly needs more.
- If the request needs new pages or frames, a redesign of whole frames, or several alternatives, don't attempt it here: call ${SUGGEST_JOB_TOOL} and briefly tell the user why.
- Keep replies short: say what you changed in one or two sentences.`;

const RENDER_HINT: Record<Variant['render'], string> = {
  tool: '- After editing, call render once to check the result visually and fix anything that looks wrong.',
  auto: '- Each edit result includes a render of the layer in scope (or the page). Check it and fix anything that looks wrong.',
  none: '- Verify numbers with get_node when you need to; you cannot see pixels.',
};

/** v2 (from v1 failures): fonts fall back silently; card rows need equal heights. */
const CRAFT = `<craft>
- Every text layer you create sets fontFamily explicitly (the token font, "SF Pro"), together with fontStyle. Without a family the editor uses a default font that may not be installed: it then renders Regular whatever fontStyle says, and inspect will not tell you. Check weights in the render.
- New sections copy the look of the existing page: the same section padding, heading size and weight (headings are Bold or Semibold, never Regular), card fill and radius. Read a sibling section first (get_node) and reuse its values.
- Rows of cards: a horizontal row with crossAlign min; give each card sizingH fill and sizingV fill so they share the tallest height, make each card a vertical layout, and push a card's button to the bottom with a spacer frame (sizingV fill, no fill) or mainAlign spaceBetween.
- Buttons are horizontal auto-layout frames (padding, mainAlign center, crossAlign center, sizingH hug unless they fill a card) with a text child; labels Semibold or Medium.
- Build a whole section in one batch, then render once and fix what looks off in a second batch.
</craft>`;

export function systemFor(v: Variant): Anthropic.TextBlockParam[] {
  const shape =
    v.tools === 'run_command'
      ? '- You have no batch tool: make each edit with run_command (each call is its own undo step), as few calls as possible.'
      : '';
  const commandsBlock =
    v.prompt === 'full-catalog'
      ? `<command_catalog>\n${catalog().text}\n</command_catalog>`
      : `<commands>\nThe commands you will need (id* = undoable — label {params}). ${
          v.tools === 'curated' ? 'Only these are allowed.' : 'list_commands finds others.'
        }\n${catalogLines(CURATED_COMMANDS)}\n</commands>`;
  const text =
    v.prompt === 'minimal'
      ? `${BASE}\n${RENDER_HINT[v.render]}\n\n${TOKENS_BLOCK}`
      : [
          BASE + '\n' + RENDER_HINT[v.render] + (shape ? `\n${shape}` : ''),
          CONVENTIONS,
          ...(v.prompt === 'v2' ? [CRAFT] : []),
          TOKENS_BLOCK,
          commandsBlock,
        ].join(
          '\n\n',
        );
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}
