/**
 * The cacheable prompt prefix (SPEC §2, ADR 0002): tools, then the system prompt. Both are
 * byte-stable for a given runtime: static text, tools sorted by name, schemas with sorted keys.
 * Nothing per-request (time, ids, user names, the document) goes here; that lives in the user
 * turn.
 *
 * The system prompt is the Story 0.3 `v2` prompt (Epic 4, D25). The tools come from the Story 1.4
 * contract (`@greenfield/contracts`), including the interactive-only control tools.
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  ASK_FOLLOWUP_TOOL,
  COMMAND_REFERENCE,
  commandInfo,
  SUGGEST_JOB_TOOL,
  suggestJobInput,
  type AgentRuntime,
  type JobSuggestion,
} from '@greenfield/contracts';
import { contractToolDefs } from './tool-defs';

/** The job hand-off tool (Story 4.5) is part of the tool contract; re-exported for the loop. */
export { SUGGEST_JOB_TOOL, suggestJobInput, type JobSuggestion };

export type CacheTtl = '5m' | '1h';

/**
 * TTL for the tools + system prefix (ADR 0002): 1h by default, so members who pause 5–60
 * minutes between prompts still hit the cache. AGENT_PREFIX_CACHE_TTL=5m switches it for
 * measurement.
 */
export function prefixCacheTtl(env: Record<string, string | undefined> = process.env): CacheTtl {
  return env.AGENT_PREFIX_CACHE_TTL === '5m' ? '5m' : '1h';
}

/**
 * The Story 0.3 `v2` prompt (D25), adapted to the 1.4 tool contract: tool names from the
 * contract, the fixture's token block replaced by the per-turn `<variables>` / `<styles>`
 * context, and the curated command reference generated from the pinned editor's command list.
 */
const BASE = `You are Greenfield's design agent. You edit a vector design document in FigCraft, a Figma-like editor, by issuing editor commands. There is no HTML or CSS: what you change is layers.

How to work:
- Change only what the request needs. Read the layers you need (the <document> context in the user's message usually has them), then make the edit with ONE run_batch (one undo step). Never delete and rebuild layers to change a property; set the property.
- Stay on the design system: use the file's variables and styles listed in the context, and the values the page already uses, not arbitrary numbers or colours.
- When layers are selected, they are the scope: change only them and their descendants. An edit outside the scope is undone and comes back as an error.
- After a visible change, call render once on the frame you changed, check it against the request, and fix anything that looks wrong with another run_batch.
- Keep replies short: say what you changed in one or two sentences.`;

const CONVENTIONS = `<editor_conventions>
- Layers have numeric ids (what commands take) and names. Keep names when you edit.
- Coordinates are px, y down, relative to the parent frame. Children of an auto layout frame are positioned by the layout: change layout, gap, padding, mainAlign, crossAlign, sizingH/sizingV instead of x/y.
- Auto layout props (node.set / node.create props): layout (horizontal|vertical|grid), gap, padding (n or [t,r,b,l]), mainAlign (min|center|max|spaceBetween|spaceAround|spaceEvenly), crossAlign (min|center|max|baseline), sizingH/sizingV (fixed|hug|fill), minWidth/maxWidth, grid: gridColumns, columnTracks [120, "1fr", "auto"], columnGap/rowGap.
- Colours are "#RRGGBB" or "#RRGGBBAA". fill / stroke take a colour or "none"; fills / strokes take paint lists.
- Text props: characters (or text.set), fontFamily, fontStyle, fontSize, lineHeight ("150%"), letterSpacing, textAlign, textAutoResize (widthAndHeight|height|none).
- run_batch runs commands in order as ONE undo step; the first failure rolls everything back. A step named with "as" can be referenced later with {"$ref": name} (its result's id) or {"$ref": name, "field": "ids/0"}.
- New layers become the selection unless params say select: false.
</editor_conventions>`;

const CRAFT = `<craft>
- Every text layer you create sets fontFamily explicitly (the family the page already uses; read a sibling text layer), together with fontStyle. Without a family the editor uses a default font that may not be installed: it then renders Regular whatever fontStyle says, and get_node will not tell you. Check weights in the render.
- New sections copy the look of the existing page: the same section padding, heading size and weight (headings are Bold or Semibold, never Regular), card fill and radius. Read a sibling section first (get_node) and reuse its values.
- Rows of cards: a horizontal row with crossAlign min; give each card sizingH fill and sizingV fill so they share the tallest height, make each card a vertical layout, and push a card's button to the bottom with a spacer frame (sizingV fill, no fill) or mainAlign spaceBetween.
- Buttons are horizontal auto-layout frames (padding, mainAlign center, crossAlign center, sizingH hug unless they fill a card) with a text child; labels Semibold or Medium.
- Build a whole section in one run_batch, then render once and fix what looks off in a second run_batch.
</craft>`;

/** `id* — label {params}` (`*` = undoable), as the 0.3 spike documented them. */
const COMMANDS_BLOCK = `<commands>
The commands you will need (id* = undoable — label {params}). list_commands finds others.
${COMMAND_REFERENCE.map((id) => {
  const c = commandInfo(id);
  return c ? `${id}${c.undoable ? '*' : ''} — ${c.label} ${c.params}` : id;
}).join('\n')}
</commands>`;

const SYSTEM_COMMON = [BASE, CONVENTIONS, CRAFT, COMMANDS_BLOCK].join('\n\n');

const SYSTEM_INTERACTIVE = `${SYSTEM_COMMON}

You are on the quick-edit path. If the request needs new pages or frames, redesigning whole frames, or several alternatives, don't attempt it here: call ${SUGGEST_JOB_TOOL} and briefly tell the user why. Ask follow-up questions with ${ASK_FOLLOWUP_TOOL} only when the request is genuinely ambiguous; the call ends your turn.`;

const SYSTEM_JOB = `${SYSTEM_COMMON}

You are running as a background job. Finish with a short summary of what you changed.`;

export function systemPromptFor(runtime: AgentRuntime): string {
  return runtime === 'interactive' ? SYSTEM_INTERACTIVE : SYSTEM_JOB;
}

/** Tools for a runtime: the contract's definitions, sorted by name (cache-stable). */
export function toolsForPrefix(runtime: AgentRuntime): Anthropic.Tool[] {
  return contractToolDefs(runtime).map(
    (d) =>
      ({
        name: d.name,
        description: d.description,
        input_schema: d.input_schema,
      }) as Anthropic.Tool,
  );
}

export interface Prefix {
  system: Anthropic.TextBlockParam[];
  tools: Anthropic.Tool[];
}

/**
 * Build the prefix. The cache breakpoint sits on the system prompt, which renders after the
 * tools, so one entry covers both.
 */
export function buildPrefix(runtime: AgentRuntime, ttl: CacheTtl = '1h'): Prefix {
  return {
    tools: toolsForPrefix(runtime),
    system: [
      {
        type: 'text',
        text: systemPromptFor(runtime),
        cache_control: ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' },
      },
    ],
  };
}

/** The prefix exactly as it goes on the wire (tools render first), for stability tests. */
export const prefixBytes = (p: Prefix) => JSON.stringify({ tools: p.tools, system: p.system });
