import type { LyricIdentity } from "./provider";

interface RecordingDetails {
  id?: string;
  recordingId?: string;
  title?: string;
  artists?: readonly string[];
  artistCredits?: readonly { name: string }[];
  albumTitle?: string | null;
  durationMs?: number | null;
  versionLabel?: string;
  language?: string;
  alternateTitles?: readonly string[];
  metadata?: Record<string, unknown>;
}

/** Server actions use the same verified credits/edition as the listening player. */
export function recordingLyricIdentity(recording: RecordingDetails): LyricIdentity {
  const metadata = recording.metadata || {};
  const credits = recording.artistCredits || (Array.isArray(metadata.artistCredits) ? metadata.artistCredits as { name: string }[] : []);
  const artists = [...new Set([...(recording.artists || (Array.isArray(metadata.artists) ? metadata.artists.map(String) : [])), ...credits.map(credit => credit.name)].filter(Boolean))];
  const version = metadata.version as { labels?: string[]; kinds?: string[] } | undefined;
  const durationMs = recording.durationMs ?? (typeof metadata.durationMs === "number" ? metadata.durationMs : undefined);
  return {
    recordingId: recording.recordingId || recording.id,
    title: recording.title || (typeof metadata.title === "string" ? metadata.title : ""),
    artist: artists[0] || "", artists,
    album: recording.albumTitle || (typeof metadata.albumTitle === "string" ? metadata.albumTitle : undefined),
    durationSeconds: typeof durationMs === "number" && durationMs > 0 ? durationMs / 1000 : undefined,
    versionLabel: recording.versionLabel || version?.labels?.join(" · ") || version?.kinds?.join(" · ") || undefined,
    language: recording.language || (typeof metadata.language === "string" ? metadata.language : undefined),
    alternateTitles: recording.alternateTitles || (Array.isArray(metadata.alternateTitles) ? metadata.alternateTitles.filter((value): value is string => typeof value === "string") : undefined),
  };
}
