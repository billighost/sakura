import type { UserSettings } from "./types";

type ReadingPreferences = Pick<UserSettings, "japaneseReading" | "lyricReading">;

/** Either legacy reading choice carries forward to the shared preference. */
export function lyricReadingEnabled(settings: ReadingPreferences): boolean {
  return settings.lyricReading === true || settings.japaneseReading === true;
}

/** Keep old clients compatible while every listening surface shares one switch. */
export function lyricReadingPatch(enabled: boolean): Required<ReadingPreferences> {
  return { lyricReading: enabled, japaneseReading: enabled };
}
