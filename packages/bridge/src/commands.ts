/**
 * Command typing on top of the generated map (`generated/commands.ts`), and the step references
 * `command.batch` understands (FigCraft docs/mcp.md › Step references).
 */
import type { CommandParamsMap } from './generated/commands';

export type CommandId = keyof CommandParamsMap;
export type CommandParams<C extends CommandId> = CommandParamsMap[C];

/** The result of an earlier step named with `as` (its `id`, or `field`: a key or `a/0/b` path). */
export interface NamedRef {
  $ref: string;
  field?: string;
}
/** The result of step `n` (zero-based, earlier steps only). */
export interface StepRef {
  $step: number;
  field?: string;
}
export type Ref = NamedRef | StepRef;

/** `T` where any value (or list item, or nested field) may instead be a step reference. */
export type WithRefs<T> = T extends readonly (infer U)[]
  ? readonly WithRefs<U>[] | Ref
  : T extends object
    ? { [K in keyof T]: WithRefs<T[K]> } | Ref
    : T | Ref;

/** One `command.batch` step, typed per command. */
export type BatchStep = {
  [C in CommandId]: {
    command: C;
    params?: WithRefs<CommandParams<C>>;
    /** Name this step so later steps can use `ref(name)`. Unique within the batch. */
    as?: string;
  };
}[CommandId];

/** `{$ref: name}`: the `id` (or `field`) in the result of the step named `name`. */
export const ref = (name: string, field?: string): NamedRef =>
  field === undefined ? { $ref: name } : { $ref: name, field };

/** `{$step: n}`: the `id` (or `field`) in the result of step `n` (zero-based). */
export const step = (n: number, field?: string): StepRef =>
  field === undefined ? { $step: n } : { $step: n, field };

/** Whether a value is a step reference (any object with `$ref` or `$step`). */
export const isRef = (v: unknown): v is Ref =>
  typeof v === 'object' && v !== null && ('$ref' in v || '$step' in v);
