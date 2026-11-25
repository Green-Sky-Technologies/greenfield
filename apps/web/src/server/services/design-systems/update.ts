/**
 * Library updates (Story 10.6): what a new version of a system changes, and bringing a file that
 * started from an older version up to it.
 *
 * A file holds its system's variables, styles and components as its own (see "What attached
 * means" in `index.ts`), so updating it rewrites the file's document on the server:
 * - variables are matched by collection name and variable name; values change, new ones are
 *   added (modes are matched by position), the file's own variables are left alone;
 * - styles are matched by type and name; text layers using a changed text style take its values;
 * - layers bound to a changed variable get the new value stored (fill, stroke, gap, padding,
 *   radius), so the file shows it as soon as it opens;
 * - each library component (by name, on the system's pages) gets the new version's content under
 *   its own id, so instances keep pointing at it, and new components are added to those pages.
 * The file's own pages and layers are not otherwise touched.
 */
import type { DesignSystemItem } from '@greenfield/db';
import type { FigcraftDocument } from './library-file';

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

// ---- what changes ----

export interface LibraryChange {
  kind: 'colour' | 'spacing' | 'type' | 'component';
  change: 'added' | 'removed' | 'changed';
  name: string;
  /** For a changed value: before → after, as text. */
  from?: string;
  to?: string;
}

function flat(items: DesignSystemItem[]) {
  const out = new Map<string, { kind: LibraryChange['kind']; value: string }>();
  for (const i of items)
    switch (i.kind) {
      case 'colours':
        for (const c of i.colours)
          out.set(`colour:${c.name}`, { kind: 'colour', value: c.hex ?? '' });
        break;
      case 'spacing':
        for (const v of i.values)
          out.set(`spacing:${v.name}`, { kind: 'spacing', value: String(v.value) });
        break;
      case 'type':
        out.set(`type:${i.name}`, {
          kind: 'type',
          value: `${i.fontFamily} ${i.fontStyle} ${i.fontSize}`,
        });
        break;
      case 'component':
        out.set(`component:${i.name}`, { kind: 'component', value: String(i.variants) });
        break;
    }
  return out;
}

/** What publishing `next` changes for files on `prev` (both as the review keeps them). */
export function libraryChanges(
  prev: DesignSystemItem[],
  next: DesignSystemItem[],
): LibraryChange[] {
  const a = flat(prev);
  const b = flat(next);
  const out: LibraryChange[] = [];
  const name = (k: string) => k.slice(k.indexOf(':') + 1);
  for (const [k, v] of b) {
    const old = a.get(k);
    if (!old) out.push({ kind: v.kind, change: 'added', name: name(k) });
    else if (old.value !== v.value)
      out.push({ kind: v.kind, change: 'changed', name: name(k), from: old.value, to: v.value });
  }
  for (const [k, v] of a)
    if (!b.has(k)) out.push({ kind: v.kind, change: 'removed', name: name(k) });
  return out;
}

/** "2 tokens and 1 component changed". */
export function changeSummary(changes: LibraryChange[]): string {
  const tokens = changes.filter((c) => c.kind !== 'component').length;
  const components = changes.length - tokens;
  const part = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  if (!changes.length) return 'No changes';
  return [tokens ? part(tokens, 'token') : null, components ? part(components, 'component') : null]
    .filter(Boolean)
    .join(' and ')
    .concat(' changed');
}

// ---- updating a file ----

const variablesOf = (d: FigcraftDocument) => (d.variables?.variables ?? []) as Json[];
const collectionsOf = (d: FigcraftDocument) => (d.variables?.collections ?? []) as Json[];

function maxNumber(values: string[], prefix: string): number {
  let max = 0;
  for (const v of values)
    if (v.startsWith(prefix)) {
      const n = Number(v.slice(prefix.length));
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
  return max;
}

/** First-mode value of a variable (no alias resolution: library values are plain). */
const firstValue = (v: Json) => (isRecord(v.values) ? Object.values(v.values)[0] : undefined);

/** Write a bound variable's value into the layer's stored field. */
function applyBound(node: Json, field: string, value: unknown) {
  if (!isRecord(value)) return;
  const v = value.value;
  if (value.type === 'color' && isRecord(v)) {
    const key = field === 'fill' ? 'fills' : field === 'stroke' ? 'strokes' : null;
    const paints = key && Array.isArray(node[key]) ? (node[key] as Json[]) : null;
    if (paints?.[0] && isRecord(paints[0])) paints[0].color = { ...v };
    return;
  }
  if (value.type !== 'number' || typeof v !== 'number') return;
  const layout = isRecord(node.layout) ? node.layout : null;
  const pad = layout && Array.isArray(layout.padding) ? (layout.padding as number[]) : null;
  if (field === 'gap' && layout) layout.gap = v;
  else if (field === 'paddingHorizontal' && pad) [pad[1], pad[3]] = [v, v];
  else if (field === 'paddingVertical' && pad) [pad[0], pad[2]] = [v, v];
  else if (field === 'cornerRadius') node.corners = { radii: [v, v, v, v], smoothing: 0 };
}

/** The system's pages in a file that started from it (`startingDocument` names them). */
export function systemPages(doc: FigcraftDocument, systemName: string): number[] {
  return doc.pages.filter((id) => {
    const n = str(doc.nodes[String(id)]?.name);
    return n === systemName || n.startsWith(`${systemName} / `);
  });
}

/**
 * The file's document brought up to `library` (the new published library file). Returns the
 * new document; the input is not changed.
 */
export function updateDocument(
  file: FigcraftDocument,
  library: FigcraftDocument,
  systemName: string,
): FigcraftDocument {
  const out = structuredClone(file);
  out.variables ??= { collections: [], variables: [] };
  const vars = (out.variables.variables ??= []) as Json[];
  const cols = (out.variables.collections ??= []) as Json[];

  // Variables: library id → file id, updating values and adding what's new.
  const varId = new Map<unknown, string>();
  const changedVars = new Set<string>();
  let nextVar = maxNumber(
    vars.map((v) => str(v.id)),
    'VariableID:',
  );
  let nextCol = maxNumber(
    cols.map((c) => str(c.id)),
    'VariableCollectionId:',
  );
  for (const lc of collectionsOf(library)) {
    let fc = cols.find((c) => c.name === lc.name);
    const libModes = Array.isArray(lc.modes) ? (lc.modes as Json[]) : [];
    if (!fc) {
      const id = `VariableCollectionId:${++nextCol}`;
      fc = {
        ...structuredClone(lc),
        id,
        modes: libModes.map((m, i) => ({ ...m, id: `${id}/mode${i + 1}` })),
      };
      cols.push(fc);
    }
    const fileModes = (Array.isArray(fc.modes) ? (fc.modes as Json[]) : []).map((m) => str(m.id));
    for (const lv of variablesOf(library).filter((v) => v.collection === lc.id)) {
      const values: Json = {};
      libModes.forEach((m, i) => {
        const target = fileModes[i] ?? fileModes[0];
        const value = isRecord(lv.values) ? lv.values[str(m.id)] : undefined;
        if (target && value !== undefined && !(target in values))
          values[target] = structuredClone(value);
      });
      const fv = vars.find((v) => v.collection === fc!.id && v.name === lv.name);
      if (fv) {
        if (JSON.stringify(fv.values) !== JSON.stringify(values)) {
          fv.values = values;
          changedVars.add(str(fv.id));
        }
        varId.set(lv.id, str(fv.id));
      } else {
        const id = `VariableID:${++nextVar}`;
        vars.push({ ...structuredClone(lv), id, collection: fc.id, values });
        varId.set(lv.id, id);
      }
    }
  }

  // Styles: library id → file id.
  const styles = (out.styles ??= []) as Json[];
  const styleId = new Map<unknown, string>();
  const changedStyles = new Map<string, Json>();
  let nextStyle = maxNumber(
    styles.map((s) => str(s.id)),
    'S:',
  );
  for (const ls of (library.styles ?? []) as Json[]) {
    const fs = styles.find((s) => s.type === ls.type && s.name === ls.name);
    if (fs) {
      for (const k of ['style', 'paints', 'effects', 'grids', 'description'])
        if (k in ls && JSON.stringify(fs[k]) !== JSON.stringify(ls[k])) {
          fs[k] = structuredClone(ls[k]);
          changedStyles.set(str(fs.id), fs);
        }
      styleId.set(ls.id, str(fs.id));
    } else {
      const id = `S:${++nextStyle}`;
      styles.push({ ...structuredClone(ls), id });
      styleId.set(ls.id, id);
    }
  }

  // Library components: the new content under the file's ids (instances keep their main).
  let nextNode = Math.max(out.next_id ?? 0, ...Object.keys(out.nodes).map(Number)) + 1;
  const pages = systemPages(out, systemName);
  const fileMains = new Map<string, Json>();
  const collect = (id: unknown) => {
    const n = out.nodes[String(id)];
    if (!n) return;
    if (n.type === 'component' || n.type === 'componentSet') fileMains.set(str(n.name), n);
    else for (const c of Array.isArray(n.children) ? n.children : []) collect(c);
  };
  for (const p of pages) collect(p);
  const removeTree = (id: unknown) => {
    const n = out.nodes[String(id)];
    if (!n) return;
    for (const c of Array.isArray(n.children) ? n.children : []) removeTree(c);
    delete out.nodes[String(id)];
  };
  const remap = (n: Json): Json => {
    const copy = structuredClone(n);
    if (isRecord(copy.bound))
      for (const [k, v] of Object.entries(copy.bound)) copy.bound[k] = varId.get(v) ?? v;
    if (isRecord(copy.styles))
      for (const [k, v] of Object.entries(copy.styles)) if (v) copy.styles[k] = styleId.get(v) ?? v;
    if (isRecord(copy.style) && copy.style.style_id)
      copy.style.style_id = styleId.get(copy.style.style_id) ?? copy.style.style_id;
    return copy;
  };
  /** Copy a library subtree into the file under `parent`, with new ids (or `keepId` at the top). */
  const copyTree = (libId: unknown, parent: number, keepId?: number): number => {
    const src = library.nodes[String(libId)];
    const id = keepId ?? nextNode++;
    const node = remap(src ?? {});
    node.id = id;
    node.parent = parent;
    node.children = (Array.isArray(src?.children) ? src.children : []).map((c) => copyTree(c, id));
    out.nodes[String(id)] = node;
    return id;
  };
  const libMains: Json[] = [];
  const walkLib = (id: unknown) => {
    const n = library.nodes[String(id)];
    if (!n) return;
    if (n.type === 'component' || n.type === 'componentSet') libMains.push(n);
    else for (const c of Array.isArray(n.children) ? n.children : []) walkLib(c);
  };
  for (const p of library.pages) walkLib(p);
  for (const lm of libMains) {
    const fm = fileMains.get(str(lm.name));
    if (fm) {
      const id = fm.id as number;
      const parent = fm.parent as number;
      const keep = { transform: fm.transform };
      for (const c of Array.isArray(fm.children) ? fm.children : []) removeTree(c);
      copyTree(lm.id, parent, id);
      Object.assign(out.nodes[String(id)]!, keep);
    } else if (pages[0] !== undefined) {
      const page = out.nodes[String(pages[0])]!;
      const id = copyTree(lm.id, pages[0]);
      page.children = [...(Array.isArray(page.children) ? page.children : []), id];
    }
  }
  out.next_id = nextNode;

  // Layers bound to a changed variable, and text using a changed text style, show the new value.
  const valueOf = new Map(vars.map((v) => [str(v.id), firstValue(v)]));
  for (const n of Object.values(out.nodes)) {
    if (isRecord(n.bound))
      for (const [field, id] of Object.entries(n.bound))
        if (changedVars.has(str(id))) applyBound(n, field, valueOf.get(str(id)));
    if (n.type === 'text' && isRecord(n.style) && changedStyles.has(str(n.style.style_id))) {
      const s = changedStyles.get(str(n.style.style_id))!;
      if (isRecord(s.style)) n.style = { ...structuredClone(s.style), style_id: n.style.style_id };
    }
  }
  return out;
}
