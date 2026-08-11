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
  /**
   * Deezer's own genre id, where one exists and actually works.
   *
   * Only `/chart/<id>/tracks` honours these — `/genre/<id>/artists` and
   * `/chart/<id>/artists` return the same geo-localised popular list whatever id
   * you pass, which is why artist lookups go through playlists instead (see
   * `getGenreSeedArtists`).
   *
   * Deliberately absent for most genres. Deezer's taxonomy is 22 broad
   * top-level buckets plus a few extras, so anything narrower than that has no
   * honest id: amapiano, gqom, drill, grime, phonk, lo-fi, highlife, soca and
   * anime simply aren't in it. Mapping them to the nearest bucket is worse than
   * leaving them out — K-Pop was mapped to `2`, which is African Music, so
   * browsing K-Pop returned Asake and BNXN. No id means the playlist path
   * handles it, which is both correct and better.
   */
  deezerId?: number;
}

export const GENRES: GenreDef[] = [
  { id: "pop", label: "Pop", Icon: PopIcon, tone: "#ef6d97", deezerId: 132 },
  { id: "hip-hop", label: "Hip-Hop", Icon: HipHopIcon, tone: "#b98cf0", aliases: ["rap"], deezerId: 116 },
  { id: "rnb", label: "R&B", Icon: RnBIcon, tone: "#7f8ef5", aliases: ["r&b", "rhythm and blues"], deezerId: 165 },
  { id: "afrobeats", label: "Afrobeats", Icon: AfroIcon, tone: "#f0a23c", aliases: ["afrobeat", "afro pop"] },
  { id: "amapiano", label: "Amapiano", Icon: AfroIcon, tone: "#e8863f" },
  { id: "gqom", label: "Gqom", Icon: AfroIcon, tone: "#d4762f", aliases: ["gqom sa"] },
  { id: "highlife", label: "Highlife", Icon: AfroIcon, tone: "#e8a13f" },
  { id: "afro house", label: "Afro House", Icon: HouseIcon, tone: "#e09a4f", aliases: ["afrohouse"] },
  { id: "rock", label: "Rock", Icon: RockIcon, tone: "#f0674f", deezerId: 152 },
  { id: "alternative", label: "Alternative", Icon: RockIcon, tone: "#d9705f", deezerId: 85 },
  { id: "indie", label: "Indie", Icon: FolkIcon, tone: "#8fbf6e" },
  { id: "emo", label: "Emo", Icon: RockIcon, tone: "#c95c8f", aliases: ["emo rock", "pop punk"] },
  { id: "punk", label: "Punk", Icon: MetalIcon, tone: "#e05c7a" },
  { id: "metal", label: "Metal", Icon: MetalIcon, tone: "#8f95a3", deezerId: 464 },
  { id: "electronic", label: "Electronic", Icon: ElectronicIcon, tone: "#43c3d6", deezerId: 106 },
  { id: "edm", label: "Dance / EDM", Icon: HouseIcon, tone: "#3fb6f0", aliases: ["dance"], deezerId: 113 },
  { id: "house", label: "House", Icon: HouseIcon, tone: "#4fa8e8", aliases: ["deep house"] },
  { id: "techno", label: "Techno", Icon: ElectronicIcon, tone: "#3f9fd6" },
  { id: "trance", label: "Trance", Icon: ElectronicIcon, tone: "#6f8fe8" },
  { id: "drum & bass", label: "Drum & Bass", Icon: ElectronicIcon, tone: "#5ad1b4" },
  { id: "phonk", label: "Phonk", Icon: ElectronicIcon, tone: "#7f6fb8" },
  { id: "drill", label: "Drill", Icon: HipHopIcon, tone: "#8f8fb8" },
  { id: "grime", label: "Grime", Icon: HipHopIcon, tone: "#7f7fa8" },
  { id: "jazz", label: "Jazz", Icon: JazzIcon, tone: "#d8a24a", deezerId: 129 },
  { id: "blues", label: "Blues", Icon: JazzIcon, tone: "#5b8fd6", deezerId: 153 },
  { id: "soul", label: "Soul", Icon: GospelIcon, tone: "#c98cd6", deezerId: 169 },
  { id: "funk", label: "Funk", Icon: ReggaeIcon, tone: "#e0913f" },
  { id: "disco", label: "Disco", Icon: PopIcon, tone: "#e876b8" },
  { id: "reggae", label: "Reggae", Icon: ReggaeIcon, tone: "#5cbf72", deezerId: 144 },
  { id: "dancehall", label: "Dancehall", Icon: ReggaeIcon, tone: "#6ec95c" },
  { id: "soca", label: "Soca", Icon: ReggaeIcon, tone: "#4fc98f" },
  { id: "gospel", label: "Gospel", Icon: GospelIcon, tone: "#e6b84f", deezerId: 187 },
  { id: "country", label: "Country", Icon: FolkIcon, tone: "#c9954f", deezerId: 84 },
  { id: "folk", label: "Folk", Icon: FolkIcon, tone: "#9fb572", deezerId: 466 },
  { id: "classical", label: "Classical", Icon: ClassicalIcon, tone: "#a8a2b8", deezerId: 98 },
  /*
   * K-Pop, J-Pop and Anime have no honest Deezer id — see the note on
   * `deezerId`. The playlist path handles all three well: "Top K-Pop" gives
   * Stray Kids and BTS, and "anime" gives Linked Horizon, LiSA and UVERworld,
   * where the old `k-pop → 2` mapping gave Nigerian afrobeats.
   */
  { id: "k-pop", label: "K-Pop", Icon: KPopIcon, tone: "#f07ab0", aliases: ["kpop"] },
  { id: "j-pop", label: "J-Pop", Icon: KPopIcon, tone: "#f095c4", aliases: ["jpop", "japanese pop"] },
  { id: "anime", label: "Anime", Icon: KPopIcon, tone: "#e86f9f", aliases: ["anime songs", "anisong"] },
  { id: "bollywood", label: "Bollywood", Icon: LatinIcon, tone: "#f0a04f", aliases: ["hindi", "desi"] },
  { id: "latin", label: "Latin", Icon: LatinIcon, tone: "#f0834f", aliases: ["reggaeton"], deezerId: 197 },
  { id: "salsa", label: "Salsa", Icon: LatinIcon, tone: "#e8734f" },
  { id: "lo-fi", label: "Lo-Fi", Icon: LoFiIcon, tone: "#8e9bb5", aliases: ["lofi", "chillhop"] },
  { id: "ambient", label: "Ambient", Icon: LoFiIcon, tone: "#7fa8b8" },
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
