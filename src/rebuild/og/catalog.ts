export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_PREVIEW_REVISION = "2";
export const OG_PREVIEW_ORIGIN = "https://sakura-orcin.vercel.app";

export const OG_DIRECTIONS = [
  { id: "a", name: "Paper & Petals", mood: "Quiet, warm, unmistakably Sakura.", detail: "Warm paper, botanical drawings, and room to breathe.", color: "#f5f5ee", ink: "#273b34" },
  { id: "b", name: "After Hours", mood: "A little cinematic. A little intimate.", detail: "Deep forest ink, soft light, and artwork that draws you in.", color: "#182b22", ink: "#e8eddd" },
  { id: "c", name: "Petal Press", mood: "The one that catches your eye.", detail: "Dusty pink, bold print, and playful record sleeves.", color: "#e1beb7", ink: "#273b34" },
] as const;
export type OgDirection = typeof OG_DIRECTIONS[number]["id"];
export type OgKind = "brand" | "artist" | "album" | "track" | "playlist" | "mix" | "lyric" | "bloom" | "page";
export type OgFixture = "original" | "long" | "missing";
export type OgGroup = "Start here" | "Music & sharing" | "Bloom" | "Everyday pages" | "About & account";

export interface OgPreviewPage {
  id: string;
  label: string;
  route: string;
  group: OgGroup;
  kind: OgKind;
  eyebrow: string;
  title: string;
  subtitle: string;
  detail: string;
  action: string;
  description: string;
  artwork?: string;
  darkArtwork?: string;
  collage?: string[];
  visibility: "public" | "account" | "shared";
}

const art = "/og-preview/artwork/";
const collage = [art + "ayra-album.jpg", art + "burna-album.jpg", art + "rema-album.jpg", art + "ayra-portrait.jpg"];
const everyday = (id: string, label: string, route: string, title: string, subtitle: string, group: OgGroup = "Everyday pages", visibility: OgPreviewPage["visibility"] = "account"): OgPreviewPage => ({
  id, label, route, group, kind: "page", eyebrow: label.toUpperCase(), title, subtitle,
  detail: "Your little music world", action: "A little room to listen", description: subtitle, visibility,
});

// These are illustrative design samples, not published metadata or listener data.
export const OG_PAGES: readonly OgPreviewPage[] = [
  { id: "default", label: "Website & fallback", route: "/", group: "Start here", kind: "brand", eyebrow: "A LITTLE ROOM TO LISTEN", title: "Your little\nmusic world.", subtitle: "Music, with room to breathe.", detail: "Favorite songs. New discoveries. Your own pace.", action: "Let the world wait a little", description: "A quiet place for favorite songs, new discoveries, synchronized lyrics, and listening without hurry.", visibility: "public" },
  { id: "artist", label: "Artist", route: "/artist/[id]", group: "Music & sharing", kind: "artist", eyebrow: "THE ARTIST", title: "Ayra Starr", subtitle: "A voice you keep coming back to.", detail: "Afropop · R&B", action: "Listen on Sakura", description: "Listen to Ayra Starr on Sakura. Find favorite songs, albums, and a little room to discover more.", artwork: art + "ayra-portrait.jpg", visibility: "account" },
  { id: "album", label: "Album", route: "/album/[id]", group: "Music & sharing", kind: "album", eyebrow: "THE ALBUM", title: "The Year I\nTurned 21", subtitle: "Ayra Starr", detail: "2024 · 15 songs", action: "Play a little", description: "The Year I Turned 21 by Ayra Starr. Open the album and listen at your own pace on Sakura.", artwork: art + "ayra-album.jpg", visibility: "account" },
  { id: "track", label: "Song", route: "/track/[id]", group: "Music & sharing", kind: "track", eyebrow: "A SONG FOR YOUR DAY", title: "Commas", subtitle: "Ayra Starr", detail: "The Year I Turned 21 · 2:37", action: "Listen on Sakura", description: "Commas by Ayra Starr. Listen, follow the lyrics, and keep your favorite songs close on Sakura.", artwork: art + "ayra-album.jpg", visibility: "account" },
  { id: "playlist", label: "Playlist", route: "/playlist/[id]", group: "Music & sharing", kind: "playlist", eyebrow: "A LITTLE COLLECTION", title: "Soft\nmornings.", subtitle: "For the days that begin slowly.", detail: "24 songs · A little over an hour", action: "Find your own pace", description: "Soft mornings. A little collection of songs for slow starts and softer days on Sakura.", collage, visibility: "account" },
  { id: "mix", label: "Mix", route: "/mix/[id]", group: "Music & sharing", kind: "mix", eyebrow: "MADE FOR YOUR MOMENT", title: "A little after\nmidnight.", subtitle: "Good songs. No hurry.", detail: "A Sakura mix · A little closer to you", action: "Stay a little longer", description: "A little after midnight. Open a Sakura mix and settle into your next favorite song.", collage, visibility: "account" },
  { id: "shared-track", label: "Shared song", route: "/s/[slug] · song", group: "Music & sharing", kind: "track", eyebrow: "A SONG, SHARED WITH YOU", title: "Commas", subtitle: "Ayra Starr", detail: "Sent with a little soul", action: "Listen on Sakura", description: "Someone saved you a song. Listen to Commas by Ayra Starr on Sakura.", artwork: art + "ayra-album.jpg", visibility: "shared" },
  { id: "lyric", label: "Shared lyrics", route: "/s/[slug] · lyrics", group: "Music & sharing", kind: "lyric", eyebrow: "THIS PART STAYED WITH ME", title: "Energy wrong,\nI log off.", subtitle: "Commas · Ayra Starr", detail: "A few words, shared from Sakura", action: "Listen to this moment", description: "A few words from Commas by Ayra Starr, shared from Sakura. Open the song and listen to this moment.", artwork: art + "ayra-album.jpg", visibility: "shared" },
  { id: "bloom", label: "Bloom collection", route: "/bloom", group: "Bloom", kind: "bloom", eyebrow: "SAKURA BLOOM", title: "Your listening,\nin full bloom.", subtitle: "The songs become a story.", detail: "A little world made from your music", action: "See what grew", description: "Your listening, in full bloom. Explore the music stories in your own little Sakura world.", artwork: art + "bloom-light.jpg", darkArtwork: art + "bloom-dark.jpg", visibility: "account" },
  { id: "bloom-story", label: "Bloom story", route: "/bloom/[id]", group: "Bloom", kind: "bloom", eyebrow: "YOUR NOVEMBER BLOOM", title: "A month of music.\nA world of you.", subtitle: "Your November, remembered in songs.", detail: "November 2026 · A listening story", action: "Step into your story", description: "A month of music, a world of you. Your November listening story in Sakura Bloom.", artwork: art + "bloom-light.jpg", darkArtwork: art + "bloom-dark.jpg", visibility: "account" },
  everyday("home", "Home", "/home", "Welcome to your\nlittle world.", "The songs you love. The ones you haven’t met yet."),
  everyday("discover", "Discover", "/discover", "Your next favorite\nis out there.", "Follow a little curiosity. Find a little magic."),
  everyday("search", "Search", "/search", "Find the song.\nKeep the feeling.", "Artists, albums, and the words stuck in your head."),
  everyday("library", "Your library", "/library", "The things\nyou keep.", "A home for your songs, albums, and little collections."),
  everyday("liked", "Liked songs", "/liked", "Some songs\nstay with you.", "All your favorites, in one little place."),
  everyday("downloads", "Downloads", "/library/downloaded", "Take a little\nmusic with you.", "Your saved songs. Ready when the world goes quiet."),
  everyday("profile", "Profile", "/profile", "A little more\nlike you.", "Your listening, your favorites, your own little world."),
  everyday("settings", "Settings", "/settings", "Make yourself\nat home.", "A little room to listen, just the way you like it."),
  everyday("import", "Import playlists", "/import", "Bring your\nfavorites along.", "Give your playlists a little room in Sakura."),
  everyday("onboarding", "Getting started", "/onboarding", "Let’s find\nyour kind of music.", "A few favorites. A whole little world to discover."),
  everyday("offline", "Offline", "/offline", "A little music.\nAnywhere.", "Your saved songs, even when you’re away."),
  everyday("login", "Sign in", "/login", "Your music\nmissed you.", "Come back to your own little music world.", "About & account"),
  everyday("register", "Create account", "/register", "A little world,\njust for you.", "Make a home for the songs you love.", "About & account"),
  everyday("about", "About Sakura", "/about", "Music, with\nroom to breathe.", "A quiet place for favorite songs and new discoveries.", "About & account", "public"),
  everyday("privacy", "Privacy", "/privacy", "Your music.\nYour space.", "A little care for the things that make you, you.", "About & account", "public"),
  everyday("terms", "Terms", "/terms", "A little care\nfor the music.", "Thoughtful listening begins with a little respect.", "About & account", "public"),
];

export function isOgDirection(value: unknown): value is OgDirection {
  return OG_DIRECTIONS.some(direction => direction.id === value);
}
export function isOgFixture(value: unknown): value is OgFixture {
  return value === "original" || value === "long" || value === "missing";
}
export function getOgPreviewPage(id: string, fixture: OgFixture = "original"): OgPreviewPage | undefined {
  const page = OG_PAGES.find(item => item.id === id);
  if (!page) return undefined;
  if (fixture === "missing") return { ...page, artwork: undefined, darkArtwork: undefined, collage: undefined };
  if (fixture === "long") return {
    ...page,
    title: page.kind === "artist" ? "The Japanese House & friends" : page.kind === "lyric" ? "Somewhere between the last song and the first light, we found a little room to breathe." : "Songs for the long way home, and all the places in between",
    subtitle: "A longer name, with a little room to breathe.",
  };
  return page;
}
export function ogPreviewImageUrl(page: string, direction: OgDirection, fixture: OgFixture = "original", format: "png" | "webp" = "png") {
  return `/og-preview/render?page=${encodeURIComponent(page)}&option=${direction}&sample=${fixture}&format=${format}&v=${OG_PREVIEW_REVISION}`;
}
