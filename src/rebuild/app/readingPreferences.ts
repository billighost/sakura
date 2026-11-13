import type { UserSettings } from "./types";

type ReadingPreferences = Pick<UserSettings, "japaneseReading" | "lyricReading">;

/** Readings start enabled; an explicit disable still survives saved preferences. */
export function lyricReadingEnabled(settings: ReadingPreferences): boolean {
  return settings.lyricReading === true || settings.japaneseReading === true
    || (settings.lyricReading !== false && settings.japaneseReading !== false);
}

/** Keep old clients compatible while every listening surface shares one switch. */
export function lyricReadingPatch(enabled: boolean): Required<ReadingPreferences> {
  return { lyricReading: enabled, japaneseReading: enabled };
}
