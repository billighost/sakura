import type { UserSettings } from "./types";

export function feedTasteKey(settings: UserSettings) {
 return JSON.stringify([settings.discovery, settings.seedArtists, settings.seedGenres,
  settings.seedArtistSelections, settings.explicitContent, settings.artistVariety,
  settings.repeatTolerance, settings.newReleaseBias, settings.deepCutBias, settings.timeAware,
  settings.learnFromListening, settings.timeZone, settings.privateSession, settings.initialTasteProfile]);
}
export function feedViewKey(accountId: string, surface: "home" | "discover", mode: string, settings: UserSettings) {
 return accountId + ":" + surface + ":" + mode + ":" + feedTasteKey(settings);
}
