import type { LyricStudioDraft } from "./lyricStudio";

/** Ordinary manuscript edits wait for a brief idle interval, with a fixed
 * maximum age. Precise timing edits and closing/backgrounding flush at once. */
export class StudioDraftWriter {
  private pending: Omit<LyricStudioDraft, "savedAt"> | undefined;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private maximum: ReturnType<typeof setTimeout> | undefined;
  private discarded = false;
  constructor(private write: (draft: LyricStudioDraft) => void, private options: {
    delayMs?: number; maxDelayMs?: number; now?: () => number;
    schedule?: typeof setTimeout; cancel?: typeof clearTimeout;
  } = {}) {}

  update(draft: Omit<LyricStudioDraft, "savedAt">, precise = false) {
    if (this.discarded) return;
    this.pending = draft;
    if (precise) { this.flush(); return; }
    const schedule = this.options.schedule || setTimeout, cancel = this.options.cancel || clearTimeout;
    cancel(this.idle);
    this.idle = schedule(() => this.flush(), this.options.delayMs ?? 250);
    this.maximum ??= schedule(() => this.flush(), this.options.maxDelayMs ?? 1000);
  }

  flush() {
    const cancel = this.options.cancel || clearTimeout;
    cancel(this.idle); cancel(this.maximum); this.idle = this.maximum = undefined;
    const draft = this.pending; this.pending = undefined;
    if (draft && !this.discarded) this.write({ ...draft, savedAt: (this.options.now || Date.now)() });
  }

  /** Accepted publication must never restore the removed local draft. */
  discard() { this.discarded = true; this.pending = undefined; this.flush(); }
}
