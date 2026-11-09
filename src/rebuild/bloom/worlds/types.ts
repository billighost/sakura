import type { ReactNode } from "react";
import type { BloomListeningProfile } from "../uiTypes";
import type { BloomExperience } from "../experience";

export type BloomQuality = 1 | 2 | 3 | 4 | 5;
export type BloomWorldId = "sakura" | "jungle" | "disco" | "japan" | "china" | "korea" | "india" | "ocean" | "cosmos" | "glass";
export type BloomSceneKind = "opening" | "time" | "comparison" | "days" | "breadth" | "songs" | "song-winner" | "artist" | "artist-songs" | "artists" | "discoveries" | "returns" | "genres" | "pattern" | "finale";
export type BloomOpeningPhase = "arriving" | "settled" | "entering" | "entered";

/** Each world owns its illustrated staging; shared content stays semantic. */
export interface BloomWorldProps {
  scene: BloomSceneKind;
  stage: number;
  progress: number;
  quality: BloomQuality;
  reducedMotion: boolean;
  view: "cover" | "story" | "poster";
  theme: "light" | "dark";
  listening?: BloomListeningProfile;
  experience?: BloomExperience;
  /** Story-only choreography. The opening resolves into the same illustrated world. */
  openingPhase?: BloomOpeningPhase;
  children?: ReactNode;
}

export interface BloomWorldDefinition {
  id: BloomWorldId;
  name: string;
  subtitle: string;
  description: string;
  colours: readonly [string, string, string];
}
