import type { PlayerLyricLine } from "./useLyrics";
let selected: { recordingId: string; lines: PlayerLyricLine[] } | null = null;
export function setShareSelection(recordingId: string, lines: readonly PlayerLyricLine[]) { selected = { recordingId, lines: lines.map((line) => ({ ...line })) }; }
export function getShareSelection(recordingId: string | undefined) { return selected && selected.recordingId === recordingId ? selected.lines : []; }
