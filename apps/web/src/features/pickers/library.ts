'use client';

/**
 * The file's own variables and styles (Stories 5.9, 5.11), as the pickers and the Design tab list
 * them. The editor sends no event for them, so they are read (`variable.list`, `style.list`) when
 * a picker opens or the selection's bindings change, never on a timer.
 */
import type { EditorStore } from '@greenfield/editor-state';
import { useEditorStore } from '@greenfield/editor-state/react';
import { useEffect, useState } from 'react';
import { rgbaToHex, type Rgba } from './colour';

export type VariableType = 'color' | 'number' | 'string' | 'boolean';
export type StyleType = 'paint' | 'text' | 'effect' | 'grid';

export interface Collection {
  id: string;
  name: string;
  /** The first is the default mode. */
  modes: { id: string; name: string }[];
}

export interface Variable {
  id: string;
  name: string;
  collection: string;
  type: VariableType;
  /** The value in the collection's default mode, for display: hex for a colour. */
  display: string;
}

export interface Style {
  id: string;
  name: string;
  type: StyleType;
  /** A paint style's first solid colour, for its swatch. */
  hex: string | null;
  /** A text style's family. */
  font: string | null;
}

export interface Library {
  collections: Collection[];
  variables: Variable[];
  styles: Style[];
}

export const EMPTY_LIBRARY: Library = { collections: [], variables: [], styles: [] };

const isRgba = (v: unknown): v is Rgba =>
  !!v && typeof v === 'object' && ['r', 'g', 'b'].every((k) => typeof (v as never)[k] === 'number');

interface RawVariable {
  id: string;
  name: string;
  collection: string;
  resolvedType: VariableType;
  /** By mode id: `{type: 'color', value: {r, g, b, a}}`, `{type: 'alias', value: <id>}`, … */
  values: Record<string, { type: string; value: unknown }>;
}

/** `variable.list`'s reply. Aliases show the value they resolve to (in default modes). */
export function parseVariables(raw: unknown): Pick<Library, 'collections' | 'variables'> {
  const r = (raw ?? {}) as { collections?: Collection[]; variables?: RawVariable[] };
  const collections = (r.collections ?? []).map((c) => ({
    id: String(c.id),
    name: String(c.name),
    modes: (c.modes ?? []).map((m) => ({ id: String(m.id), name: String(m.name) })),
  }));
  const raws = r.variables ?? [];
  const byId = new Map(raws.map((v) => [v.id, v]));
  const defaultValue = (v: RawVariable) => {
    const mode = collections.find((c) => c.id === v.collection)?.modes[0]?.id;
    return mode ? v.values[mode] : Object.values(v.values)[0];
  };
  const display = (v: RawVariable, depth = 0): string => {
    const value = defaultValue(v);
    if (value?.type === 'alias') {
      const target = byId.get(String(value.value));
      return target && depth < 8 ? display(target, depth + 1) : '';
    }
    if (isRgba(value?.value)) return rgbaToHex(value.value);
    return value && typeof value.value !== 'object' ? String(value.value) : '';
  };
  const variables = raws.map((v): Variable => ({
    id: v.id,
    name: v.name,
    collection: v.collection,
    type: v.resolvedType,
    display: display(v),
  }));
  return { collections, variables };
}

/** `style.list`'s reply. */
export function parseStyles(raw: unknown): Style[] {
  return (Array.isArray(raw) ? raw : []).map((s: Record<string, unknown>) => {
    const solid = ((s.paints ?? []) as { type?: string; color?: unknown }[]).find(
      (p) => p.type === 'solid' && isRgba(p.color),
    );
    const font = (s.style as { font_family?: unknown } | undefined)?.font_family;
    return {
      id: String(s.id),
      name: String(s.name),
      type: s.type as StyleType,
      hex: solid ? rgbaToHex(solid.color as Rgba) : null,
      font: typeof font === 'string' ? font : null,
    };
  });
}

export async function readLibrary(store: Pick<EditorStore, 'run'>): Promise<Library> {
  const [vars, styles] = await Promise.all([
    store.run('variable.list', {}),
    store.run('style.list', {}),
  ]);
  return { ...parseVariables(vars), styles: parseStyles(styles) };
}

/** The library, read again whenever `key` changes (and kept while the next read runs). */
export function useLibrary(key: string): Library {
  const store = useEditorStore();
  const [library, setLibrary] = useState(EMPTY_LIBRARY);
  useEffect(() => {
    let live = true;
    readLibrary(store)
      .then((l) => live && setLibrary(l))
      .catch(() => {}); // no editor yet: the next key change reads again
    return () => {
      live = false;
    };
  }, [store, key]);
  return library;
}

/** A variable's or style's name split for a list: `ink/900` shows as `ink / 900`. */
export const displayName = (name: string) => name.split('/').join(' / ');
