import type { TimedLyric } from "../lyrics/parse";

export interface SelectedShareInput { recordingId: string; kind: "track" | "lyric"; lines: TimedLyric[]; colorMode: "light" | "dark"; reference?: { provider: "deezer" | "spotify"; id: string } }
export class ShareInputError extends Error { constructor(message: string, public readonly status = 400) { super(message); } }
export function parseShareInput(value: unknown): SelectedShareInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ShareInputError("A share object is required");
  const input = value as Record<string, unknown>;
  if (typeof input.recordingId !== "string" || !input.recordingId.trim() || input.recordingId.length > 100) throw new ShareInputError("A recording identity is required");
  if (input.kind !== "track" && input.kind !== "lyric") throw new ShareInputError("Share kind must be track or lyric");
  const rawLines = input.lines ?? [];
  if (!Array.isArray(rawLines) || rawLines.length > 8 || (input.kind === "lyric" && !rawLines.length)) throw new ShareInputError("Choose one to eight lyric lines");
  const lines = rawLines.map((raw: unknown): TimedLyric => {
    if (!raw || typeof raw !== "object") throw new ShareInputError("Each selected line requires text and a time");
    const line = raw as Record<string, unknown>;
    if (typeof line.text !== "string" || !line.text.trim() || line.text.length > 1500 || typeof line.start !== "number" || !Number.isFinite(line.start) || line.start < 0 || line.start > 86400) throw new ShareInputError("Selected lyric line is invalid");
    return { text: line.text, start: line.start, ...(typeof line.end === "number" && Number.isFinite(line.end) && line.end >= line.start ? { end: line.end } : {}) };
  });
  if (lines.reduce((total, line) => total + line.text.length, 0) > 3000) throw new ShareInputError("Selected lyrics are too long", 413);
  let reference: SelectedShareInput["reference"];
  if (input.reference !== undefined) {
    const ref = input.reference as Record<string, unknown>;
    if (!ref || (ref.provider !== "deezer" && ref.provider !== "spotify") || typeof ref.id !== "string" || !ref.id.trim() || ref.id.length > 100) throw new ShareInputError("Catalog reference is invalid");
    reference = { provider: ref.provider, id: ref.id };
  }
  return { recordingId: input.recordingId, kind: input.kind, lines, colorMode: input.colorMode === "dark" ? "dark" : "light", reference };
}
/** Exact source text and timing plus contiguous source order prevent substituted quote shares. */
export function verifyLyricSelection(selected: readonly TimedLyric[], source: readonly TimedLyric[]) {
  if (!selected.length || selected.length > 8) return false;
  const visible = source.filter((line) => line.text.trim());
  return visible.some((_, start) => selected.every((line, offset) => visible[start + offset]?.text === line.text && visible[start + offset]?.start === line.start));
}
