/**
 * The control half of the bridge: typed calls over `window.figcraft` (craft-web-api), with
 * fail-fast checks (hidden tab, not ready), a deadline, and the editor's rejections turned into
 * typed errors. Framework-free; `createBridge` wires it to the iframe.
 */
import type { BatchStep, CommandId, CommandParams } from './commands';
import {
  CommandError,
  EditorHiddenError,
  EditorNotReadyError,
  EditorTimeoutError,
  NoDocumentError,
  toBridgeError,
} from './errors';
import { saveKey, type KeyPlatform } from './platform';
import { base64ToBytes, pngSize } from './png';
import type {
  BatchOptions,
  BatchStepResult,
  CallOptions,
  CommandInfo,
  DocumentInfo,
  ExecuteOptions,
  EditorNode,
  GetNodeOptions,
  InspectOptions,
  NodeId,
  RenderOptions,
  RenderResult,
} from './types';

/** `window.figcraft` as the editor installs it with `?control` (the parts the bridge uses). */
export interface FigcraftApi {
  request(method: string, params?: unknown): Promise<unknown>;
  execute(command: string, params?: unknown): Promise<unknown>;
  executeAs(agent: string, command: string, params?: unknown): Promise<unknown>;
  commands(): Promise<unknown>;
  docInspect(params?: unknown): Promise<unknown>;
}

export interface ControlClientOptions {
  /** The editor's API, or a reason string when it can't be used yet. */
  api(): FigcraftApi | string;
  isHidden(): boolean;
  platform(): KeyPlatform;
  /** Default deadline per call. 35 s: the editor itself gives up after 30 s. */
  timeoutMs?: number;
  /** Called before each `execute`/`batch` (for change attribution). */
  onMutation?(): void;
}

export const DEFAULT_TIMEOUT_MS = 35_000;

/** Drop undefined keys: the editor rejects keys it doesn't know, and some reject `null`. */
const clean = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export class ControlClient {
  constructor(private readonly opts: ControlClientOptions) {}

  private async call<T>(
    method: string,
    command: string | undefined,
    run: (api: FigcraftApi) => Promise<unknown>,
    opts: CallOptions | undefined,
  ): Promise<T> {
    // Hidden tabs draw no frames and every call waits for one: fail now, not in 30 s.
    if (this.opts.isHidden()) throw new EditorHiddenError(method);
    const api = this.opts.api();
    if (typeof api === 'string') throw new EditorNotReadyError(method, api);
    const ms = opts?.timeoutMs ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return (await Promise.race([
        run(api),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new EditorTimeoutError(method, ms)), ms);
        }),
      ])) as T;
    } catch (e) {
      throw toBridgeError(method, command, e);
    } finally {
      clearTimeout(timer);
    }
  }

  execute<C extends CommandId>(
    command: C,
    params?: CommandParams<C>,
    opts?: ExecuteOptions,
  ): Promise<unknown> {
    this.opts.onMutation?.();
    return this.run(command, params ?? {}, opts);
  }

  async batch(steps: readonly BatchStep[], opts?: BatchOptions): Promise<unknown[]> {
    this.opts.onMutation?.();
    const r = await this.run('command.batch', clean({ label: opts?.label, commands: steps }), opts);
    return Array.isArray(r) ? r : [r];
  }

  private run(command: string, params: unknown, opts: ExecuteOptions | undefined) {
    const agent = opts?.agent;
    return this.call<unknown>(
      'engine.execute',
      command,
      (f) => (agent ? f.executeAs(agent, command, params) : f.execute(command, params)),
      opts,
    );
  }

  async batchContinue(
    steps: readonly BatchStep[],
    opts?: BatchOptions,
  ): Promise<BatchStepResult[]> {
    this.opts.onMutation?.();
    const params = clean({ label: opts?.label, onError: 'continue', commands: steps });
    return this.call<BatchStepResult[]>(
      'engine.execute',
      'command.batch',
      (f) => f.execute('command.batch', params),
      opts,
    );
  }

  async inspect(opts: InspectOptions = {}, call?: CallOptions): Promise<DocumentInfo> {
    const params = clean({ ...opts });
    const r = await this.call<DocumentInfo | { documents: 0 }>(
      'document.inspect',
      undefined,
      (f) => f.docInspect(params),
      call,
    );
    if (!('pages' in r) || !Array.isArray(r.pages)) throw new NoDocumentError('document.inspect');
    return r;
  }

  async getNode(
    id: NodeId,
    opts: GetNodeOptions = {},
    call?: CallOptions,
  ): Promise<EditorNode | null> {
    const params = clean({ id, ...opts });
    const r = await this.call<EditorNode | null>(
      'node.get',
      undefined,
      (f) => f.request('node.get', params),
      call,
    );
    return r ?? null;
  }

  async render(opts: RenderOptions = {}, call?: CallOptions): Promise<RenderResult> {
    const params = clean({ ids: opts.ids, scale: opts.scale });
    const r = await this.call<{ format?: string; data?: string }>(
      'ui.render',
      undefined,
      (f) => f.request('ui.render', params),
      call,
    );
    const png = typeof r?.data === 'string' ? base64ToBytes(r.data) : null;
    const size = png && pngSize(png);
    if (!png || !size) throw new CommandError('ui.render', undefined, 'the editor returned no PNG');
    return { png, ...size };
  }

  commands(call?: CallOptions): Promise<CommandInfo[]> {
    return this.call('engine.commands', undefined, (f) => f.commands(), call);
  }

  request(method: string, params?: unknown, opts?: CallOptions): Promise<unknown> {
    return this.call(method, undefined, (f) => f.request(method, params ?? {}), opts);
  }

  /** Press Save the way the platform does (Cmd+S on a Mac, Ctrl+S elsewhere). */
  async save(opts?: CallOptions): Promise<void> {
    await this.request('ui.key', saveKey(this.opts.platform()), opts);
  }
}
