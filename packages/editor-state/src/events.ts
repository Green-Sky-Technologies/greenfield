/**
 * Editor events (`figcraft:event {name, data}`) to store actions. The names and shapes are the
 * editor's own (the fork's `host_sync.rs`); anything malformed or unknown is dropped (null), never
 * thrown, since the editor may grow events before this package knows them.
 */
import type { EditorEvent } from '@greenfield/bridge';
import type { EditorAction, NodeFields, NodeId, Placement } from './types';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const ids = (v: unknown): NodeId[] | null =>
  Array.isArray(v) && v.every(isNum) ? (v as NodeId[]) : null;
const fieldsList = (v: unknown): NodeFields[] | undefined =>
  Array.isArray(v) ? (v.filter((n) => isObj(n) && isNum(n.id)) as NodeFields[]) : undefined;
const placements = (v: unknown): Placement[] | undefined =>
  Array.isArray(v)
    ? v
        .filter((p): p is Obj => isObj(p) && isNum(p.id) && isNum(p.index))
        .map((p) => ({
          id: p.id as NodeId,
          parent: isNum(p.parent) ? p.parent : null,
          index: p.index as number,
        }))
    : undefined;

export function fromEditorEvent({ name, data }: EditorEvent): EditorAction | null {
  const d: Obj = isObj(data) ? data : {};
  switch (name) {
    case 'selection.changed': {
      const selected = ids(d.ids);
      if (!isNum(d.document) || !isNum(d.page) || !selected) return null;
      const nodes = fieldsList(d.nodes);
      return {
        type: name,
        document: d.document,
        page: d.page,
        ids: selected,
        ...(nodes ? { nodes } : {}),
      };
    }
    case 'document.changed': {
      if (!isNum(d.document) || !isNum(d.revision) || !isNum(d.undoDepth)) return null;
      const lists = {
        nodes: fieldsList(d.nodes),
        added: placements(d.added),
        removed: placements(d.removed),
        moved: placements(d.moved),
      };
      return {
        type: name,
        document: d.document,
        revision: d.revision,
        undoDepth: d.undoDepth,
        ...(typeof d.agent === 'string' ? { agent: d.agent } : {}),
        ...(d.resync === true ? { resync: true } : {}),
        ...Object.fromEntries(Object.entries(lists).filter(([, v]) => v !== undefined)),
      };
    }
    case 'tool.changed':
      return typeof d.tool === 'string' ? { type: name, tool: d.tool } : null;
    case 'viewport.changed':
      return isNum(d.zoom) && isNum(d.x) && isNum(d.y)
        ? { type: name, zoom: d.zoom, x: d.x, y: d.y }
        : null;
    case 'text.editing':
      return { type: name, id: isNum(d.id) ? d.id : null };
    case 'interaction.changed':
      return {
        type: name,
        active: d.active === true,
        label: typeof d.label === 'string' ? d.label : null,
        host: d.host === true,
      };
    case 'canvas.mode':
      return typeof d.on === 'boolean' ? { type: name, on: d.on } : null;
    case 'agent.presence':
      return typeof d.active === 'boolean'
        ? {
            type: name,
            active: d.active,
            name: typeof d.name === 'string' ? d.name : 'Claude',
            layers: ids(d.layers) ?? [],
          }
        : null;
    case 'ui.request': {
      if (typeof d.kind !== 'string') return null;
      const s = d.screen;
      const screen = isObj(s) && isNum(s.x) && isNum(s.y) ? { x: s.x, y: s.y } : null;
      return { type: name, kind: d.kind, screen, data: d.data };
    }
  }
  return null;
}
