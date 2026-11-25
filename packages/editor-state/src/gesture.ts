/**
 * A drag or scrub as one undo step, over the editor's gesture commands (Story 2.12): `edit.begin`,
 * `edit.preview` per move, `edit.commit` or `edit.cancel`. From the Story 5.0 spike (ADR 0005):
 *
 * - Previews are absolute (the editor resets to the gesture's start before each), so dropping an
 *   old value is always safe: at most two are in flight and the newest replaces the one waiting.
 * - `edit.begin` fails while another gesture is open, and a lost commit (a hidden tab, a dropped
 *   reply) leaves one open for good. A stale gesture is cancelled and the begin retried.
 */
import type { CommandId, CommandParams, Editor } from '@greenfield/bridge';

/** Previews the editor may hold at once (its replies arrive on a 16 ms poll). */
const IN_FLIGHT = 2;

export interface PreviewCommand<C extends CommandId = CommandId> {
  command: C;
  params: CommandParams<C>;
}

export class Gesture {
  private begun: Promise<void> | null = null;
  private started = false;
  private inFlight = 0;
  private pending: readonly PreviewCommand[] | null = null;
  private ended = false;
  private waiters: (() => void)[] = [];

  constructor(
    private readonly editor: Editor,
    private readonly label: string,
  ) {}

  /** Show `commands`' result on the canvas, from where the gesture began. */
  preview(commands: readonly PreviewCommand[]): void {
    if (this.ended) return;
    this.pending = commands;
    if (this.started) return this.pump();
    this.begun ??= this.begin().then(() => {
      this.started = true;
      this.pump();
    });
    this.begun.catch(() => this.settle());
  }

  /** The previews become one undo step (none if nothing was previewed). */
  async commit(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    if (!this.begun) return;
    await this.begun;
    await this.idle();
    await this.editor.execute('edit.commit', {});
  }

  /** Put the document back where the gesture began. */
  async cancel(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.pending = null;
    if (!this.begun) return;
    await this.begun.catch(() => undefined);
    await this.idle();
    await this.editor.execute('edit.cancel', {});
  }

  private async begin(): Promise<void> {
    const begin = () => this.editor.execute('edit.begin', { label: this.label });
    try {
      await begin();
    } catch (e) {
      if (!/already in progress/i.test(String(e))) throw e;
      await this.editor.execute('edit.cancel', {});
      await begin();
    }
  }

  private pump(): void {
    while (this.pending && this.inFlight < IN_FLIGHT) {
      const commands = this.pending;
      this.pending = null;
      this.inFlight++;
      this.editor
        .execute('edit.preview', { commands } as CommandParams<'edit.preview'>)
        .catch(() => undefined) // a failing preview keeps the last good one (the editor's rule)
        .finally(() => {
          this.inFlight--;
          this.pump();
          this.settle();
        });
    }
  }

  private settle(): void {
    if (this.inFlight || this.pending) return;
    for (const w of this.waiters.splice(0)) w();
  }

  /** Resolves once every preview sent or waiting has landed. */
  private idle(): Promise<void> {
    if (!this.inFlight && !this.pending) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}
