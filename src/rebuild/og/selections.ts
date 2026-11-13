import type { OgDirection } from "./catalog";

// Owner-selected in the OG preview gallery on 2026-11-13.
export const OG_SELECTIONS: Readonly<Record<string, OgDirection>> = {
  default: "c", artist: "b", album: "b", track: "c", playlist: "b", mix: "b",
  "shared-track": "c", lyric: "c", bloom: "b", "bloom-story": "b",
  home: "b", discover: "b", search: "b", library: "b", liked: "c", downloads: "c",
  profile: "c", settings: "c", import: "c", onboarding: "c", offline: "c",
  login: "c", register: "c", about: "c", privacy: "c", terms: "c",
};
export const OG_IMAGE_REVISION = "20261113-3";
export function ogDirectionFor(page: string): OgDirection { return OG_SELECTIONS[page] || OG_SELECTIONS.default; }
