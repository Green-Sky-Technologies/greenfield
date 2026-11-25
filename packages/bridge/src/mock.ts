/**
 * `MockEditor`: an in-memory `Editor` for unit tests (`@greenfield/bridge/mock`).
 *
 * It keeps a layer tree and implements the commands app code relies on, with the real editor's
 * shapes and error messages:
 *
 * - `file.new`, `node.create`, `node.set` (`props` or flat), `text.set`, `edit.delete`,
 *   `select.set`, `command.batch` (one undo step, `as` / `$ref` / `$step` with `field` paths, `onError`),
 *   `edit.undo` (`{undone}`), `variable.list` and `style.list` (what `setDesignSystem()` seeded)
 * - `document.inspect` (`depth`, `fields`, `outline`), `node.get`, `ui.render` (a 1×1 PNG),
 *   `engine.commands` (the pinned editor's full list), `ui.key` Save
 * - host messages: ready, dirty, save (`saveAs` as the editor decides it), open of its own saves
 *
 * Ids are deterministic: pages from 1, layers from 2, as in a new FigCraft document. Parameters
 * are checked against the pinned editor's key lists, so a typo fails here as it would for real.
 * Other commands from the pinned list reject with "MockEditor doesn't implement …".
 *
 * Test hooks: `setHidden()`, `fail()`, `setDesignSystem()`, `userExecute()` (an edit "by a person", not counted as a
 * control edit), `calls` (every control call), and `ready: false` to post ready yourself.
 */
import { ChangeDetector } from './change-detect';
import { isRef, type BatchStep, type CommandId, type CommandParams } from './commands';
import {
  BridgeError,
  CommandError,
  EditorFailedError,
  EditorHiddenError,
  EditorNotReadyError,
  NoDocumentError,
} from './errors';
import { COMMANDS, EDITOR_VERSION, NODE_FIELDS, NODE_SET_PROPS } from './generated/commands';
import { saveKey, type KeyPlatform } from './platform';
import { base64ToBytes, TINY_PNG_BASE64 } from './png';
import type {
  BatchOptions,
  BatchStepResult,
  CallOptions,
  ChangeDetectorOptions,
  ChangeSet,
  CommandInfo,
  DocumentInfo,
  Editor,
  EditorEvent,
  EditorNode,
  GetNodeOptions,
  InspectOptions,
  NodeId,
  ReadyInfo,
  RenderOptions,
  RenderResult,
  SaveEvent,
  Unsubscribe,
} from './types';

export interface MockEditorOptions {
  /** Post ready at once (default). With `false`, call `makeReady()`. */
  ready?: boolean;
  appVersion?: string;
  /**
   * Start with an untitled document open (default). `false` starts like host mode, on the home
   * screen: calls fail with `NoDocumentError` until `open()` or `file.new`.
   */
  document?: boolean;
  /** Which Save shortcut `ui.key` accepts. Default `mac`. */
  platform?: KeyPlatform;
  changes?: ChangeDetectorOptions;
}

interface MNode {
  id: NodeId;
  type: string;
  props: Record<string, unknown>;
  children: MNode[];
}

interface MDoc {
  id: number;
  name: string;
  /** The file the host opened or the last Save As named: decides `saveAs`. */
  file: string | null;
  pages: MNode[];
  currentPage: NodeId;
  selection: NodeId[];
  undo: string[];
  dirty: boolean;
  nextId: number;
}

const MOCK_FORMAT = 'greenfield-mock-editor/1';
const CONTAINERS = new Set(['PAGE', 'FRAME', 'SECTION', 'COMPONENT', 'GROUP']);
const CREATE_TYPES = new Set(
  'rectangle ellipse polygon star line arrow vector text frame section component slice'.split(' '),
);
const FIELD_SET = new Set<string>(NODE_FIELDS);
const PROP_SET = new Set<string>(NODE_SET_PROPS);
const META = new Map(COMMANDS.map((c) => [c.id, c]));
const SUPPORTED = new Set([
  'file.new',
  'node.create',
  'node.set',
  'text.set',
  'edit.delete',
  'select.set',
  'command.batch',
  'edit.undo',
  'variable.list',
  'style.list',
]);

const fail = (command: string, message: string) =>
  new CommandError('engine.execute', command, message);
const solid = (color: unknown) => [{ type: 'solid', color: String(color).toUpperCase() }];
const isNone = (v: unknown) => v === null || (typeof v === 'string' && v.toLowerCase() === 'none');

class Emitter<T> {
  private readonly set = new Set<(v: T) => unknown>();
  add(cb: (v: T) => unknown): Unsubscribe {
    this.set.add(cb);
    return () => this.set.delete(cb);
  }
  emit(v: T): unknown[] {
    return [...this.set].map((cb) => cb(v));
  }
}

export class MockEditor implements Editor {
  /** Every control call, in order: `{method, command?, params}`. */
  readonly calls: { method: string; command?: string; params?: unknown }[] = [];
  private doc: MDoc;
  private docCounter = 0;
  private hidden = false;
  private hasDocument: boolean;
  private disposed = false;
  private readyInfo: ReadyInfo | null = null;
  private failure: string | null = null;
  private readonly appVersion: string;
  private readonly platform: KeyPlatform;
  private readonly readyCbs = new Emitter<ReadyInfo>();
  private readonly dirtyCbs = new Emitter<boolean>();
  private readonly saveCbs = new Emitter<SaveEvent>();
  private readonly failedCbs = new Emitter<string>();
  private readonly eventCbs = new Emitter<EditorEvent>();
  private readonly visibilityCbs = new Set<() => void>();
  private readyWaiters: { resolve(i: ReadyInfo): void; reject(e: Error): void }[] = [];
  private readonly detector: ChangeDetector;
  /** The document before each undo step, newest last (`edit.undo` restores the last). */
  private undoSnapshots: MDoc[] = [];
  private variables: unknown = { collections: [], variables: [] };
  private styles: unknown[] = [];

  constructor(opts: MockEditorOptions = {}) {
    this.appVersion = opts.appVersion ?? EDITOR_VERSION;
    this.platform = opts.platform ?? 'mac';
    this.doc = this.newDoc('Untitled');
    this.hasDocument = opts.document !== false;
    this.detector = new ChangeDetector(
      {
        inspect: (o) => this.inspect(o),
        isHidden: () => this.hidden,
        onVisibilityChange: (cb) => {
          this.visibilityCbs.add(cb);
          return () => this.visibilityCbs.delete(cb);
        },
      },
      opts.changes,
    );
    if (opts.ready !== false) this.makeReady();
  }

  // ---------------------------------------------------------------- test hooks

  /** Post `figcraft:ready`. */
  makeReady(): void {
    if (this.readyInfo) return;
    const info = { version: '1', appVersion: this.appVersion };
    this.readyInfo = info;
    for (const w of this.readyWaiters.splice(0)) w.resolve(info);
    queueMicrotask(() => this.readyCbs.emit(info));
  }

  /** Post `figcraft:failed`. */
  fail(error: string): void {
    this.failure = error;
    for (const w of this.readyWaiters.splice(0)) w.reject(new EditorFailedError(error));
    this.failedCbs.emit(error);
  }

  /** Post an editor event (`figcraft:event`), e.g. a recorded `selection.changed`. */
  postEvent(name: string, data: unknown): void {
    this.eventCbs.emit({ name, data });
  }

  /** Pretend the tab was hidden or shown (`visibilitychange`). */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const cb of [...this.visibilityCbs]) cb();
  }

  /**
   * What `variable.list` and `style.list` return, in the real editor's shapes:
   * `{collections, variables}` and a list of styles.
   */
  setDesignSystem(ds: { variables?: unknown; styles?: unknown[] }): void {
    if (ds.variables !== undefined) this.variables = structuredClone(ds.variables);
    if (ds.styles !== undefined) this.styles = structuredClone(ds.styles);
  }

  /** Run a command as a person would (not counted in `ChangeSet.controlEdits`). */
  userExecute<C extends CommandId>(command: C, params?: CommandParams<C>): Promise<unknown> {
    return this.guard('engine.execute', async () => this.runTop(command, params ?? {}));
  }

  // ---------------------------------------------------------------- lifecycle and host messages

  get isReady(): boolean {
    return !this.disposed && this.readyInfo !== null;
  }

  ready(): Promise<ReadyInfo> {
    if (this.readyInfo) return Promise.resolve(this.readyInfo);
    if (this.failure) return Promise.reject(new EditorFailedError(this.failure));
    return new Promise((resolve, reject) => this.readyWaiters.push({ resolve, reject }));
  }

  onReady(cb: (info: ReadyInfo) => void): Unsubscribe {
    const off = this.readyCbs.add(cb);
    const info = this.readyInfo;
    if (info) queueMicrotask(() => cb(info));
    return off;
  }
  onDirty(cb: (dirty: boolean) => void): Unsubscribe {
    return this.dirtyCbs.add(cb);
  }
  onSave(cb: (e: SaveEvent) => void | Promise<void>): Unsubscribe {
    return this.saveCbs.add(cb);
  }
  onFailed(cb: (error: string) => void): Unsubscribe {
    return this.failedCbs.add(cb);
  }
  onEvent(cb: (e: EditorEvent) => void): Unsubscribe {
    return this.eventCbs.add(cb);
  }

  /**
   * Open a document. The mock's own saves reopen exactly; any other bytes (a real `.figcraft`)
   * open as an empty document under that name.
   */
  open(name: string, bytes: Uint8Array | ArrayBuffer): void {
    if (!this.isReady) throw new EditorNotReadyError('open');
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let doc: MDoc | null = null;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(data)) as { format?: string; doc?: MDoc };
      if (parsed.format === MOCK_FORMAT && parsed.doc) doc = parsed.doc;
    } catch {
      // not a mock save
    }
    doc ??= this.newDoc(name.replace(/\.[^.]+$/, ''));
    this.doc = {
      ...structuredClone(doc),
      id: ++this.docCounter,
      file: name,
      dirty: false,
      undo: [],
    };
    this.hasDocument = true;
    this.undoSnapshots = [];
  }

  async save(opts?: CallOptions): Promise<void> {
    await this.request('ui.key', saveKey(this.platform), opts);
  }

  // ---------------------------------------------------------------- control

  execute<C extends CommandId>(
    command: C,
    params?: CommandParams<C>,
    _opts?: CallOptions,
  ): Promise<unknown> {
    this.detector.noteControlEdit();
    return this.guard('engine.execute', async () => this.runTop(command, params ?? {}), command);
  }

  async batch(steps: readonly BatchStep[], opts?: BatchOptions): Promise<unknown[]> {
    const r = await this.execute('command.batch', {
      ...(opts?.label === undefined ? {} : { label: opts.label }),
      commands: steps as unknown[],
    });
    return r as unknown[];
  }

  async batchContinue(
    steps: readonly BatchStep[],
    opts?: BatchOptions,
  ): Promise<BatchStepResult[]> {
    const r = await this.execute('command.batch', {
      ...(opts?.label === undefined ? {} : { label: opts.label }),
      onError: 'continue',
      commands: steps as unknown[],
    });
    return r as BatchStepResult[];
  }

  inspect(opts: InspectOptions = {}, _call?: CallOptions): Promise<DocumentInfo> {
    return this.guard('document.inspect', async () => {
      this.needDocument('document.inspect');
      return this.inspectNow(opts);
    });
  }

  getNode(id: NodeId, opts: GetNodeOptions = {}, _call?: CallOptions): Promise<EditorNode | null> {
    return this.guard('node.get', async () => {
      this.needDocument('node.get');
      const shape = this.shape(opts, 'node.get');
      const n = this.find(id);
      return n ? this.serialize(n.node, opts.depth ?? 1, shape) : null;
    });
  }

  render(opts: RenderOptions = {}, _call?: CallOptions): Promise<RenderResult> {
    return this.guard('ui.render', async () => {
      this.needDocument('ui.render');
      const ids =
        opts.ids ??
        (this.doc.selection.length ? this.doc.selection : this.page().children.map((c) => c.id));
      if (!ids.some((id) => this.find(id))) {
        throw new CommandError(
          'ui.render',
          undefined,
          'command `file.export` is not available right now: nothing to export',
        );
      }
      return { png: base64ToBytes(TINY_PNG_BASE64), width: 1, height: 1 };
    });
  }

  commands(_call?: CallOptions): Promise<CommandInfo[]> {
    return this.guard('engine.commands', async () =>
      COMMANDS.map(({ takes: _takes, ...c }) => ({ ...c })),
    );
  }

  request(method: string, params: unknown = {}, _opts?: CallOptions): Promise<unknown> {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case 'engine.execute':
        return this.execute(p.command as CommandId, p.params as never);
      case 'engine.commands':
        return this.commands();
      case 'document.inspect':
        return this.inspect(p as InspectOptions);
      case 'node.get':
        return this.getNode(p.id as NodeId, p as GetNodeOptions);
      case 'ui.render':
        return this.render(p as RenderOptions);
      case 'ui.key':
        return this.guard('ui.key', async () => {
          const want = saveKey(this.platform) as Record<string, unknown>;
          const isSave =
            String(p.key).toUpperCase() === 'S' &&
            ['cmd', 'ctrl'].every((k) => !!p[k] === !!want[k]);
          if (!isSave)
            throw new CommandError('ui.key', undefined, `no shortcut \`${String(p.key)}\``);
          this.needDocument('ui.key');
          this.emitSave();
          return { command: 'file.save' };
        });
      default:
        return this.guard(method, async () => {
          throw new CommandError(method, undefined, `MockEditor doesn't implement \`${method}\``);
        });
    }
  }

  onChange(cb: (c: ChangeSet) => void): Unsubscribe {
    return this.detector.subscribe(cb);
  }

  detectChanges(): Promise<ChangeSet | null> {
    return this.detector.detect();
  }

  dispose(): void {
    this.disposed = true;
    this.detector.stop();
  }

  // ---------------------------------------------------------------- internals

  private async guard<T>(method: string, run: () => Promise<T>, command?: string): Promise<T> {
    this.calls.push({ method, ...(command ? { command } : {}) });
    if (this.hidden) throw new EditorHiddenError(method);
    if (this.disposed) throw new EditorNotReadyError(method, 'the bridge was disposed');
    if (this.failure)
      throw new EditorNotReadyError(method, `the editor failed to start (${this.failure})`);
    if (!this.readyInfo)
      throw new EditorNotReadyError(method, 'the editor has not posted figcraft:ready yet');
    try {
      return await run();
    } catch (e) {
      if (e instanceof BridgeError) throw e;
      throw new CommandError(method, command, e instanceof Error ? e.message : String(e));
    }
  }

  private needDocument(method: string): void {
    if (!this.hasDocument) throw new NoDocumentError(method);
  }

  private newDoc(name: string): MDoc {
    return {
      id: ++this.docCounter,
      name,
      file: null,
      pages: [{ id: 1, type: 'PAGE', props: { name: 'Page 1' }, children: [] }],
      currentPage: 1,
      selection: [],
      undo: [],
      dirty: false,
      nextId: 2,
    };
  }

  private page(): MNode {
    return this.doc.pages.find((p) => p.id === this.doc.currentPage) ?? this.doc.pages[0]!;
  }

  private find(
    id: unknown,
    under: MNode[] = this.doc.pages,
    parent: MNode | null = null,
  ): { node: MNode; parent: MNode | null } | null {
    for (const n of under) {
      if (n.id === id) return { node: n, parent };
      const hit = this.find(id, n.children, n);
      if (hit) return hit;
    }
    return null;
  }

  private setDirty(dirty: boolean): void {
    if (this.doc.dirty === dirty) return;
    this.doc.dirty = dirty;
    this.dirtyCbs.emit(dirty);
  }

  private emitSave(): void {
    const file = this.doc.file;
    const name = file ?? `${this.doc.name}.figcraft`;
    const saveAs = file === null;
    const { id: _id, ...rest } = this.doc;
    const payload = JSON.stringify({ format: MOCK_FORMAT, doc: { ...rest, file: null } });
    this.doc.file = name;
    this.setDirty(false);
    for (const r of this.saveCbs.emit({ name, saveAs, bytes: new TextEncoder().encode(payload) })) {
      if (r instanceof Promise) r.catch(() => undefined);
    }
  }

  /** One top-level command: a single undo step (a batch is one step for all of its steps). */
  private runTop(command: string, params: Record<string, unknown>): unknown {
    if (command === 'edit.undo') {
      this.checkParams(command, params);
      this.needDocument('engine.execute');
      const prev = this.undoSnapshots.pop();
      if (!prev) return { undone: false };
      this.doc = { ...prev, id: this.doc.id, file: this.doc.file, undo: this.doc.undo.slice(1) };
      this.setDirty(true);
      return { undone: true };
    }
    const before = structuredClone(this.doc);
    let result: unknown;
    try {
      result = this.run(command, params);
    } catch (e) {
      this.doc = before;
      throw e;
    }
    const meta = META.get(command);
    let label: string | null = meta?.undoable ? meta.label : null;
    if (command === 'command.batch') {
      const ok =
        !Array.isArray(result) ||
        params.onError !== 'continue' ||
        result.some((r) => (r as BatchStepResult).ok);
      label = ok ? (typeof params.label === 'string' ? params.label : 'Batch') : null;
    }
    if (label) {
      this.undoSnapshots = [...this.undoSnapshots, before].slice(-20);
      this.doc.undo = [label, ...this.doc.undo].slice(0, 20);
      this.setDirty(true);
    }
    return result;
  }

  private checkParams(command: string, params: Record<string, unknown>): void {
    const meta = META.get(command);
    if (!meta) throw fail(command, `unknown command \`${command}\``);
    if (!SUPPORTED.has(command)) throw fail(command, `MockEditor doesn't implement \`${command}\``);
    if (command === 'node.set') {
      const bad = Object.keys(params).filter(
        (k) => !['ids', 'id', 'props'].includes(k) && !PROP_SET.has(k),
      );
      const props = (params.props ?? {}) as Record<string, unknown>;
      bad.push(...Object.keys(props).filter((k) => !PROP_SET.has(k)));
      if (bad.length)
        throw fail(
          command,
          `invalid parameters for \`node.set\`: unknown properties: ${bad.join(', ')}`,
        );
      return;
    }
    const takes = meta.takes ?? [];
    for (const k of Object.keys(params)) {
      if (k === 'ids' || k === 'id' || takes.includes(k)) continue;
      throw fail(
        command,
        `invalid parameters for \`${command}\`: unknown parameter \`${k}\` (it takes ${takes.length ? takes.join(', ') : 'none'})`,
      );
    }
  }

  private targets(command: string, params: Record<string, unknown>): MNode[] {
    const ids = Array.isArray(params.ids)
      ? params.ids
      : params.id !== undefined
        ? [params.id]
        : this.doc.selection;
    if (!ids.length)
      throw fail(
        command,
        `command \`${command}\` is not available right now: nothing is selected (pass \`ids\`)`,
      );
    return ids.map((id) => {
      const hit = this.find(id);
      if (!hit || hit.node.type === 'PAGE') throw fail(command, `no such node ${String(id)}`);
      return hit.node;
    });
  }

  private run(command: string, params: Record<string, unknown>): unknown {
    this.checkParams(command, params);
    if (command !== 'file.new') this.needDocument('engine.execute');
    switch (command) {
      case 'file.new': {
        const name = typeof params.name === 'string' ? params.name : 'Untitled';
        this.doc = this.newDoc(name);
        this.undoSnapshots = [];
        this.hasDocument = true;
        return { index: 1, kind: 'design' };
      }
      case 'node.create':
        return this.create(params);
      case 'node.set': {
        const { ids: _ids, id: _id, props, ...flat } = params;
        const all = { ...flat, ...((props ?? {}) as Record<string, unknown>) };
        for (const n of this.targets(command, params)) this.applyProps(n, all);
        return { ok: true };
      }
      case 'text.set': {
        const text = params.characters ?? params.text;
        if (typeof text !== 'string')
          throw fail(
            command,
            'invalid parameters for `text.set`: `characters` or `text` is required',
          );
        for (const n of this.targets(command, params)) {
          if (n.type !== 'TEXT') throw fail(command, `node ${n.id} is not text`);
          if (n.props.name === n.props.characters) n.props.name = text;
          n.props.characters = text;
        }
        return { ok: true };
      }
      case 'edit.delete': {
        const nodes = this.targets(command, params);
        for (const n of nodes) {
          const hit = this.find(n.id);
          if (!hit?.parent) continue;
          hit.parent.children = hit.parent.children.filter((c) => c.id !== n.id);
        }
        const gone = new Set(nodes.map((n) => n.id));
        this.doc.selection = this.doc.selection.filter((id) => !gone.has(id) && this.find(id));
        return { deleted: nodes.map((n) => n.id), hidden: [] };
      }
      case 'select.set': {
        if (!Array.isArray(params.ids))
          throw fail(command, 'invalid parameters for `select.set`: `ids` must be a list');
        for (const id of params.ids) {
          const hit = this.find(id);
          if (!hit || hit.node.type === 'PAGE') throw fail(command, `no such node ${String(id)}`);
        }
        this.doc.selection = [...new Set(params.ids as NodeId[])];
        return { ok: true };
      }
      case 'command.batch':
        return this.runBatch(params);
      case 'variable.list':
        return structuredClone(this.variables);
      case 'style.list':
        return structuredClone(this.styles);
    }
    throw fail(command, `MockEditor doesn't implement \`${command}\``);
  }

  private create(params: Record<string, unknown>): { id: NodeId } {
    const type = String(params.type ?? '');
    if (!CREATE_TYPES.has(type)) {
      throw fail(
        'node.create',
        `invalid parameters for \`node.create\`: unknown layer type \`${type}\``,
      );
    }
    let parent = this.page();
    if (params.parent !== undefined) {
      const hit = this.find(params.parent);
      if (!hit) throw fail('node.create', `no such node ${String(params.parent)}`);
      if (!CONTAINERS.has(hit.node.type))
        throw fail('node.create', `layer ${hit.node.id} can't have children`);
      parent = hit.node;
    }
    const upper = type.toUpperCase();
    const text = (params.text ?? params.characters) as string | undefined;
    const node: MNode = {
      id: this.doc.nextId++,
      type: upper,
      children: [],
      props: {
        name:
          params.name ??
          (upper === 'TEXT' ? (text ?? 'Text') : type[0]!.toUpperCase() + type.slice(1)),
        x: params.x ?? 0,
        y: params.y ?? 0,
        width: params.width ?? 100,
        height: params.height ?? (upper === 'TEXT' ? 20 : 100),
        rotation: 0,
        visible: true,
        locked: false,
        opacity: 1,
        fills:
          upper === 'TEXT'
            ? solid('#000000')
            : upper === 'FRAME'
              ? solid('#FFFFFF')
              : solid('#D9D9D9'),
        strokes: [],
        ...(upper === 'TEXT' ? { characters: text ?? '' } : {}),
      },
    };
    if (params.props) this.applyProps(node, params.props as Record<string, unknown>);
    const index = typeof params.index === 'number' ? params.index : parent.children.length;
    parent.children.splice(index, 0, node);
    if (params.select !== false) this.doc.selection = [node.id];
    return { id: node.id };
  }

  private applyProps(n: MNode, props: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(props)) {
      if (k === 'fill') n.props.fills = isNone(v) ? [] : solid(v);
      else if (k === 'stroke') n.props.strokes = isNone(v) ? [] : solid(v);
      else if (k === 'characters' && n.type !== 'TEXT')
        throw fail('node.set', `node ${n.id} is not text`);
      else n.props[k] = v;
    }
  }

  private runBatch(params: Record<string, unknown>): unknown {
    const steps = params.commands;
    if (!Array.isArray(steps))
      throw fail(
        'command.batch',
        'invalid parameters for `command.batch`: `commands` must be a list',
      );
    const cont = params.onError === 'continue';
    if (params.onError !== undefined && params.onError !== 'abort' && !cont) {
      throw fail(
        'command.batch',
        'invalid parameters for `command.batch`: `onError` is `abort` or `continue`',
      );
    }
    const names = new Map<string, number>();
    steps.forEach((s: { as?: unknown }, i) => {
      if (typeof s?.as !== 'string') return;
      if (names.has(s.as))
        throw fail('command.batch', `step ${i}: the name \`${s.as}\` is used twice`);
      names.set(s.as, i);
    });
    const results: unknown[] = [];
    const ok: boolean[] = [];
    const out: BatchStepResult[] = [];
    steps.forEach((s: { command?: unknown; params?: unknown }, i) => {
      const command = String(s?.command);
      const snapshot = cont ? structuredClone(this.doc) : null;
      try {
        const p = this.resolveRefs(
          (s?.params ?? {}) as Record<string, unknown>,
          i,
          names,
          results,
          ok,
        );
        const r = this.run(command, p as Record<string, unknown>);
        results[i] = r;
        ok[i] = true;
        out.push({ step: i, command, ok: true, result: r });
      } catch (e) {
        if (!cont) throw e;
        this.doc = snapshot!;
        ok[i] = false;
        out.push({
          step: i,
          command,
          ok: false,
          error: e instanceof CommandError ? e.editorMessage : String(e),
        });
      }
    });
    return cont ? out : results;
  }

  private resolveRefs(
    v: unknown,
    at: number,
    names: Map<string, number>,
    results: unknown[],
    ok: boolean[],
  ): unknown {
    if (Array.isArray(v)) return v.map((x) => this.resolveRefs(x, at, names, results, ok));
    if (!v || typeof v !== 'object') return v;
    if (!isRef(v)) {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, this.resolveRefs(x, at, names, results, ok)]),
      );
    }
    const r = v as { $ref?: unknown; $step?: unknown; field?: unknown };
    let index: number;
    if ('$ref' in r) {
      const name = String(r.$ref);
      const i = names.get(name);
      if (i === undefined)
        throw fail(
          'command.batch',
          `step ${at}: no step is named \`${name}\` (names: ${[...names.keys()].join(', ') || 'none'})`,
        );
      index = i;
    } else {
      index = r.$step as number;
      if (!Number.isInteger(index) || index < 0)
        throw fail('command.batch', `step ${at}: \`$step\` must be a step number`);
    }
    if (index >= at)
      throw fail('command.batch', `step ${at}: a reference must name an earlier step`);
    if (!ok[index]) throw fail('command.batch', `step ${at}: step ${index} failed`);
    const path = String(r.field ?? 'id')
      .replace(/^\//, '')
      .split('/');
    let cur: unknown = results[index];
    for (const part of path) {
      if (cur && typeof cur === 'object' && part in cur)
        cur = (cur as Record<string, unknown>)[part];
      else
        throw fail(
          'command.batch',
          `step ${at}: step ${index}'s result has no \`${path.join('/')}\``,
        );
    }
    return cur;
  }

  private shape(
    opts: { fields?: readonly string[]; outline?: boolean },
    method: string,
  ): Set<string> | null {
    if (opts.outline && opts.fields)
      throw new CommandError(method, undefined, '`outline: true` can’t be combined with `fields`');
    if (opts.outline)
      return new Set(['name', 'type', 'characters', 'mainComponentName', 'visible']);
    if (!opts.fields) return null;
    for (const f of opts.fields) {
      if (!FIELD_SET.has(f))
        throw new CommandError(
          method,
          undefined,
          `unknown field \`${f}\`; valid keys: ${NODE_FIELDS.join(', ')}`,
        );
    }
    return new Set(opts.fields);
  }

  private serialize(n: MNode, depth: number, fields: Set<string> | null): EditorNode {
    const all: Record<string, unknown> = { type: n.type, ...n.props };
    const out: EditorNode = { id: n.id };
    for (const [k, v] of Object.entries(all))
      if (!fields || fields.has(k)) out[k] = structuredClone(v);
    if (n.children.length) {
      if (depth > 0) out.children = n.children.map((c) => this.serialize(c, depth - 1, fields));
      else out.childCount = n.children.length;
    }
    return out;
  }

  private inspectNow(opts: InspectOptions): DocumentInfo {
    const fields = this.shape(opts, 'document.inspect');
    const depth = Math.min(opts.depth ?? 8, 64);
    const pages = this.doc.pages.map((p) =>
      p.id === this.doc.currentPage || opts.allPages
        ? this.serialize(p, depth, fields)
        : { id: p.id, ...(p.children.length ? { childCount: p.children.length } : {}) },
    );
    return {
      id: this.doc.id,
      name: this.doc.name,
      path: null,
      kind: 'design',
      dirty: this.doc.dirty,
      currentPage: this.doc.currentPage,
      selection: [...this.doc.selection],
      history: { undo: [...this.doc.undo], redo: 0 },
      pages,
      styles: [],
      variables: 0,
      images: 0,
      textEdit: null,
      colorProfile: 'srgb',
    };
  }
}
