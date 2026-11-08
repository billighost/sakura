/** A song without catalog duration can still seek once the media supplies it. */
export function boundedSeekPosition(positionMs: number, catalogDurationMs: number, mediaDurationMs = 0) {
  const duration = Number.isFinite(catalogDurationMs) && catalogDurationMs > 0 ? catalogDurationMs
    : Number.isFinite(mediaDurationMs) && mediaDurationMs > 0 ? mediaDurationMs : 0;
  return Math.max(0, Math.min(Number.isFinite(positionMs) ? positionMs : 0, duration));
}
