import { getCachedLyrics, setCachedLyrics } from "./offline-db";

export interface LyricLine {
  time: number;
  text: string;
}

export interface LyricData {
  lyrics?: string;
  syncedLyrics?: string;
  lines?: LyricLine[];
  isSynced: boolean;
}

// Parse standard LRC format string
export function parseLrc(lrcText: string): LyricLine[] {
  const lines = lrcText.split("\n");
  const result: LyricLine[] = [];
  const timeRegex = /\[(\d+):(\d+)(?:\.(\d+))?\]/;

  for (const line of lines) {
    const match = timeRegex.exec(line);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const ms = match[3] ? parseInt(match[3].padEnd(3, "0").substring(0, 3), 10) : 0;
      const time = min * 60 + sec + ms / 1000;
      const text = line.replace(timeRegex, "").trim();
      result.push({ time, text });
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

// Fetch lyrics directly from server-side lyrics route (aggregating LRCLib, Musixmatch, NetEase Cloud Music)
export async function getLyrics(track: {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
}): Promise<LyricData | null> {
  // Check IndexedDB cache first
  const cached = await getCachedLyrics(track.id);
  if (cached) return cached;

  try {
    const apiQueryUrl = `/api/lyrics?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}&duration=${track.duration || ""}`;
    const apiRes = await fetch(apiQueryUrl);
    if (apiRes.ok) {
      const result = await apiRes.json();
      if (result && (result.syncedLyrics || result.plainLyrics)) {
        const lrcData = formatLyricResponse({
          syncedLyrics: result.syncedLyrics,
          plainLyrics: result.plainLyrics
        });
        await setCachedLyrics(track.id, lrcData);
        return lrcData;
      }
    }
  } catch (err) {
    console.error("Backend lyrics query failed:", err);
  }

  return null;
}

function formatLyricResponse(data: any): LyricData {
  const syncedLyrics = data.syncedLyrics || "";
  const lyrics = data.plainLyrics || data.lyrics || "";
  const lines = syncedLyrics ? parseLrc(syncedLyrics) : [];

  return {
    lyrics: lyrics || undefined,
    syncedLyrics: syncedLyrics || undefined,
    lines: lines.length > 0 ? lines : undefined,
    isSynced: lines.length > 0,
  };
}
