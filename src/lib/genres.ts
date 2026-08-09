import type { ComponentType } from "react";
import {
  AfroIcon,
  ClassicalIcon,
  ElectronicIcon,
  FolkIcon,
  GospelIcon,
  HipHopIcon,
  HouseIcon,
  JazzIcon,
  KPopIcon,
  LatinIcon,
  LoFiIcon,
  MetalIcon,
  PodcastIcon,
  PopIcon,
  ReggaeIcon,
  RnBIcon,
  RockIcon,
  type IconProps,
} from "@/components/Icons";

/**
 * The one genre registry.
 *
 * Three places used to keep their own list and they disagreed: the search
 * page hardcoded 8 categories, onboarding's API had 30 with emoji, and the
 * taste engine normalised to a fourth vocabulary. A genre you could pick in
 * onboarding was not necessarily one you could browse, and neither matched
 * what the recommender actually stored.
 *
 * `id` is the normalised form `normaliseGenre()` produces, so these ids join
 * directly against Track.genre / Artist.genres / GenreAffinity.genre with no
 * translation layer.
 *
 * `tone` is used only where colour genuinely aids recognition — the browse
 * grid, where a wall of same-coloured tiles is slower to scan. It is applied
 * as a flat accent on the glyph, never as a gradient card fill.
 */

export interface GenreDef {
  id: string;
  label: string;
  Icon: ComponentType<IconProps>;
  tone: string;
  /** Extra terms to widen a provider query for this genre. */
  aliases?: string[];
}

export const GENRES: GenreDef[] = [
  { id: "pop", label: "Pop", Icon: PopIcon, tone: "#ef6d97" },
  { id: "hip-hop", label: "Hip-Hop", Icon: HipHopIcon, tone: "#b98cf0", aliases: ["rap"] },
  { id: "rnb", label: "R&B", Icon: RnBIcon, tone: "#7f8ef5", aliases: ["r&b", "rhythm and blues"] },
  { id: "afrobeats", label: "Afrobeats", Icon: AfroIcon, tone: "#f0a23c", aliases: ["afrobeat", "afro pop"] },
  { id: "amapiano", label: "Amapiano", Icon: AfroIcon, tone: "#e8863f" },
  { id: "rock", label: "Rock", Icon: RockIcon, tone: "#f0674f" },
  { id: "alternative", label: "Alternative", Icon: RockIcon, tone: "#d9705f" },
  { id: "indie", label: "Indie", Icon: FolkIcon, tone: "#8fbf6e" },
  { id: "electronic", label: "Electronic", Icon: ElectronicIcon, tone: "#43c3d6" },
  { id: "edm", label: "Dance / EDM", Icon: HouseIcon, tone: "#3fb6f0", aliases: ["dance"] },
  { id: "house", label: "House", Icon: HouseIcon, tone: "#4fa8e8", aliases: ["deep house", "afro house"] },
  { id: "drum & bass", label: "Drum & Bass", Icon: ElectronicIcon, tone: "#5ad1b4" },
  { id: "jazz", label: "Jazz", Icon: JazzIcon, tone: "#d8a24a" },
  { id: "blues", label: "Blues", Icon: JazzIcon, tone: "#5b8fd6" },
  { id: "soul", label: "Soul", Icon: GospelIcon, tone: "#c98cd6" },
  { id: "funk", label: "Funk", Icon: ReggaeIcon, tone: "#e0913f" },
  { id: "reggae", label: "Reggae", Icon: ReggaeIcon, tone: "#5cbf72" },
  { id: "dancehall", label: "Dancehall", Icon: ReggaeIcon, tone: "#6ec95c" },
  { id: "gospel", label: "Gospel", Icon: GospelIcon, tone: "#e6b84f" },
  { id: "country", label: "Country", Icon: FolkIcon, tone: "#c9954f" },
  { id: "folk", label: "Folk", Icon: FolkIcon, tone: "#9fb572" },
  { id: "classical", label: "Classical", Icon: ClassicalIcon, tone: "#a8a2b8" },
  { id: "metal", label: "Metal", Icon: MetalIcon, tone: "#8f95a3" },
  { id: "punk", label: "Punk", Icon: MetalIcon, tone: "#e05c7a" },
  { id: "k-pop", label: "K-Pop", Icon: KPopIcon, tone: "#f07ab0", aliases: ["kpop"] },
  { id: "j-pop", label: "J-Pop", Icon: KPopIcon, tone: "#f095c4", aliases: ["jpop"] },
  { id: "latin", label: "Latin", Icon: LatinIcon, tone: "#f0834f", aliases: ["reggaeton"] },
  { id: "lo-fi", label: "Lo-Fi", Icon: LoFiIcon, tone: "#8e9bb5", aliases: ["lofi", "chillhop"] },
  { id: "ambient", label: "Ambient", Icon: LoFiIcon, tone: "#7fa8b8" },
  { id: "highlife", label: "Highlife", Icon: AfroIcon, tone: "#e8a13f" },
  { id: "drill", label: "Drill", Icon: HipHopIcon, tone: "#8f8fb8" },
  { id: "podcast", label: "Podcasts", Icon: PodcastIcon, tone: "#a89b8f" },
];

export const GENRE_BY_ID = new Map(GENRES.map((g) => [g.id, g]));

/** Icon lookup for data that travels as a plain string (e.g. the seeds API). */
export const GENRE_ICONS: Record<string, ComponentType<IconProps>> = {
  afro: AfroIcon,
  classical: ClassicalIcon,
  electronic: ElectronicIcon,
  folk: FolkIcon,
  gospel: GospelIcon,
  hiphop: HipHopIcon,
  house: HouseIcon,
  jazz: JazzIcon,
  kpop: KPopIcon,
  latin: LatinIcon,
  lofi: LoFiIcon,
  metal: MetalIcon,
  podcast: PodcastIcon,
  pop: PopIcon,
  reggae: ReggaeIcon,
  rnb: RnBIcon,
  rock: RockIcon,
};

/** Tone lookup by the same string key, for chips rendered from API data. */
export const GENRE_TONES: Record<string, string> = {
  afro: "#f0a23c",
  classical: "#a8a2b8",
  electronic: "#43c3d6",
  folk: "#8fbf6e",
  gospel: "#e6b84f",
  hiphop: "#b98cf0",
  house: "#4fa8e8",
  jazz: "#d8a24a",
  kpop: "#f07ab0",
  latin: "#f0834f",
  lofi: "#8e9bb5",
  metal: "#8f95a3",
  podcast: "#a89b8f",
  pop: "#ef6d97",
  reggae: "#5cbf72",
  rnb: "#7f8ef5",
  rock: "#f0674f",
};
