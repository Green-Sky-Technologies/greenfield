/**
 * A layer's prototype interactions as the editor reports them (the `interactions` node field),
 * the choices the Prototype tab offers, and the `proto.interaction.set` patches it sends.
 */
import type { NodeId } from '@greenfield/bridge';

export interface Trigger {
  type: string;
  ms?: number;
  key?: string;
}

export interface Action {
  type: string;
  dest?: NodeId;
  url?: string;
  [field: string]: unknown;
}

export interface Transition {
  type: string;
  direction?: string;
}

export interface Interaction {
  trigger: Trigger;
  actions: Action[];
  transition: Transition;
  duration_ms: number;
  easing: unknown;
}

/** The node field, or none when it's missing or not the editor's shape. */
export function interactionsOf(node: Record<string, unknown> | undefined): Interaction[] {
  const list = node?.interactions;
  return Array.isArray(list) ? (list as Interaction[]) : [];
}

export const TRIGGERS = {
  onClick: 'On click',
  onHover: 'While hovering',
  onPress: 'While pressing',
  onDrag: 'On drag',
  mouseEnter: 'Mouse enter',
  mouseLeave: 'Mouse leave',
  mouseDown: 'Mouse down',
  mouseUp: 'Mouse up',
  afterDelay: 'After delay',
} as const;

/** Actions the tab can switch to; `dest` ones need a top-level frame. */
export const ACTIONS = {
  navigate: { label: 'Navigate to', dest: true },
  openOverlay: { label: 'Open overlay', dest: true },
  swapOverlay: { label: 'Swap overlay', dest: true },
  closeOverlay: { label: 'Close overlay', dest: false },
  back: { label: 'Back', dest: false },
  openUrl: { label: 'Open link', dest: false },
} as const;

export const TRANSITIONS = {
  instant: 'Instant',
  dissolve: 'Dissolve',
  smartAnimate: 'Smart animate',
  moveIn: 'Move in',
  moveOut: 'Move out',
  push: 'Push',
  slideIn: 'Slide in',
  slideOut: 'Slide out',
} as const;

const DIRECTIONAL = new Set(['moveIn', 'moveOut', 'push', 'slideIn', 'slideOut']);
export const DIRECTIONS = { left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' } as const;

export const EASINGS = {
  linear: 'Linear',
  easeIn: 'Ease in',
  easeOut: 'Ease out',
  easeInOut: 'Ease in and out',
  easeInBack: 'Ease in back',
  easeOutBack: 'Ease out back',
  easeInOutBack: 'Ease in and out back',
  gentle: 'Gentle',
  quick: 'Quick',
  bouncy: 'Bouncy',
  slow: 'Slow',
} as const;

/** The editor's delay when a trigger first becomes "After delay". */
const DEFAULT_DELAY_MS = 800;

/** Its label, or the raw name for one this tab doesn't offer (it still shows). */
export const labelOf = (table: Record<string, string>, type: string) => table[type] ?? type;

export const hasDirection = (t: Transition) => DIRECTIONAL.has(t.type);
export const needsDest = (type: string) =>
  type in ACTIONS && ACTIONS[type as keyof typeof ACTIONS].dest;

/** The `proto.interaction.set` fields that change the trigger to `type`. */
export function triggerPatch(type: string): { trigger: Trigger } {
  return { trigger: type === 'afterDelay' ? { type, ms: DEFAULT_DELAY_MS } : { type } };
}

/**
 * The patch that makes the first action `type`, or null when it needs a destination and there is
 * none. A destination carries over when the new action takes one too.
 */
export function actionPatch(
  current: Action | undefined,
  type: string,
  frames: readonly NodeId[],
): { action: Action } | null {
  if (type === 'openUrl') return { action: { type, url: current?.url ?? '' } };
  if (!needsDest(type)) return { action: { type } };
  const dest = current?.dest ?? frames[0];
  return dest == null ? null : { action: { type, dest } };
}

/** A transition of `type`, keeping the direction when both take one (default `left`). */
export function transitionPatch(current: Transition, type: string): { transition: Transition } {
  if (!DIRECTIONAL.has(type)) return { transition: { type } };
  return { transition: { type, direction: current.direction ?? 'left' } };
}
