export interface PlaybackProgress {
  readonly positionMs: number;
  readonly durationMs: number;
}

const INITIAL_PROGRESS: PlaybackProgress = { positionMs: 0, durationMs: 0 };

// Media time updates belong to the small set of progress/lyric subscribers,
// rather than to the provider that owns every scrolling music page.
export class PlaybackProgressStore {
  private snapshot: PlaybackProgress = INITIAL_PROGRESS;
  private readonly listeners = new Set<() => void>();

  readonly getSnapshot = () => this.snapshot;
  readonly getServerSnapshot = () => INITIAL_PROGRESS;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly update = (patch: Partial<PlaybackProgress>) => {
    const positionMs = patch.positionMs ?? this.snapshot.positionMs;
    const durationMs = patch.durationMs ?? this.snapshot.durationMs;
    if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs)) return;
    const next = { positionMs: Math.max(0, positionMs), durationMs: Math.max(0, durationMs) };
    if (next.positionMs === this.snapshot.positionMs && next.durationMs === this.snapshot.durationMs) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  };

  readonly setPosition = (positionMs: number) => this.update({ positionMs });
  readonly setDuration = (durationMs: number) => this.update({ durationMs });
}
