/**
 * Story 5.0 spike: a scrub over the editor's gesture commands (Story 2.12: `edit.begin`,
 * `edit.preview`, `edit.commit`, `edit.cancel`). Without them (today's editor) every move is its
 * own `node.set`, which is one undo step per move: the reason 2.12 exists.
 *
 * `preview` is latest-wins: one call in flight, and while it runs only the newest value waits.
 */
import type { Editor } from '@greenfield/bridge';
import { perf } from './perf';

type Props = Record<string, unknown>;

/** Previews the editor may hold at once. Its replies arrive on a 16 ms poll, so waiting for each would cap a scrub at ~60 previews/s per round trip. */
const IN_FLIGHT = 2;

export class Scrub {
  private inFlight = 0;
  private pending: Props | null = null;
  private seq = 0;
  private active = false;

  constructor(
    private readonly editor: Editor,
    private readonly id: number,
    private readonly gestures: boolean,
    private readonly label: string,
  ) {}

  async begin() {
    this.active = true;
    if (!this.gestures) return;
    const begin = () => this.editor.execute('edit.begin' as never, { label: this.label } as never);
    try {
      await begin();
    } catch (e) {
      // A gesture the editor still holds (a lost commit) blocks every later one: end it and retry.
      if (!/already in progress/.test(String(e))) throw e;
      await this.editor.execute('edit.cancel' as never, {} as never);
      await begin();
    }
  }

  /** Show `props` on the canvas now. While the editor is busy only the newest value waits. */
  preview(props: Props, inputT: number) {
    this.seq++;
    perf.log('scrub-move', { seq: this.seq, inputT });
    this.pending = props;
    this.pump();
  }

  private pump() {
    while (this.pending && this.active && this.inFlight < IN_FLIGHT) {
      const props = this.pending;
      this.pending = null;
      const seq = this.seq;
      const t0 = performance.now();
      this.inFlight++;
      perf.log('scrub-sent', { seq });
      const call = this.gestures
        ? this.editor.execute('edit.preview' as never, {
            commands: [{ command: 'node.set', params: { ids: [this.id], ...props } }],
          } as never)
        : this.editor.execute('node.set', { ids: [this.id], ...props } as never);
      void call
        .catch((e: unknown) => perf.log('scrub-error', { message: e instanceof Error ? e.message : String(e) }))
        .finally(() => {
          this.inFlight--;
          perf.log('scrub-applied', { seq, callMs: performance.now() - t0 });
          this.pump();
        });
    }
  }

  async commit() {
    // Let the last preview land first.
    while (this.inFlight || this.pending) await new Promise((r) => setTimeout(r, 1));
    this.active = false;
    if (this.gestures) await this.editor.execute('edit.commit' as never, {} as never);
  }

  async cancel() {
    this.pending = null;
    while (this.inFlight) await new Promise((r) => setTimeout(r, 1));
    this.active = false;
    if (this.gestures) await this.editor.execute('edit.cancel' as never, {} as never);
  }
}
