import type { Metadata } from "next";
import type { PublicShare } from "../player/SharedSong";
import type { OgPreviewPage } from "../og/catalog";
import { cleanPreviewText, entityOgImagePath, makeShareMetadata, staticOgData, staticOgImagePath } from "./metadata";
import { decodedEntityId, readPublicEntityPreview, type PublicEntityKind, type PublicEntityPreview } from "./public-data";

export function entityOgData(kind: PublicEntityKind, preview: PublicEntityPreview): OgPreviewPage {
  const base = staticOgData(kind);
  const artists = preview.artists.join(" · ");
  const subtitle = artists || (kind === "artist" ? "A voice you keep coming back to." : base.subtitle);
  const description = kind === "artist" ? `Listen to ${preview.title} on Sakura. Find songs, albums, and a little room to discover more.` : kind === "playlist" ? `${preview.title}. A playlist on Sakura. Open the collection and listen at your own pace.` : kind === "mix" ? `${preview.title}. A Sakura mix. Good songs, no hurry.` : `${preview.title}${artists ? " by " + artists : ""}. ${kind === "album" ? "Open the album" : "Listen and follow the lyrics"} on Sakura.`;
  return { ...base, title: preview.title, subtitle, description, detail: preview.detail || base.detail, artwork: preview.artwork || (kind === "mix" ? preview.collage?.[0] : undefined), collage: preview.collage };
}
export async function entityPageMetadata(kind: PublicEntityKind, rawId: string): Promise<Metadata> {
  const id = decodedEntityId(rawId);
  const preview = await readPublicEntityPreview(kind, id);
  const data = preview ? entityOgData(kind, preview) : staticOgData(kind);
  return makeShareMetadata({ title: preview?.title || data.label, description: data.description, path: `/${kind}/${encodeURIComponent(id)}`, image: preview ? entityOgImagePath(kind, id) : staticOgImagePath(kind), alt: cleanPreviewText(data.title) + " · Sakura", indexable: false });
}
export function shareOgData(share: PublicShare): OgPreviewPage {
  const lyric = share.kind === "lyric";
  const base = staticOgData(lyric ? "lyric" : "shared-track");
  const payload = share.payload;
  const title = cleanPreviewText(payload.title, 100) || "A song from Sakura";
  const artists = payload.artists.map(artist => cleanPreviewText(artist, 80)).filter(Boolean).slice(0, 5).join(" · ");
  const lines = payload.lines.slice(0, 2).map(line => cleanPreviewText(line.text, 65)).filter(Boolean);
  const quote = lines.join("\n");
  return { ...base, title: lyric && quote ? quote : title, subtitle: lyric ? title + (artists ? " · " + artists : "") : artists || base.subtitle, detail: lyric ? "A few words, shared from Sakura" : cleanPreviewText(payload.albumTitle, 100) || base.detail,
    artwork: payload.coverUrl || undefined, description: lyric ? `A few words from ${title}${artists ? " by " + artists : ""}, shared from Sakura. Open the song and listen to this moment.` : `Listen to ${title}${artists ? " by " + artists : ""}, shared with you from Sakura.` };
}
export function publicShareMetadata(share: PublicShare): Metadata {
  const data = shareOgData(share);
  const title = cleanPreviewText(share.payload.title, 100) + (share.kind === "lyric" ? " — shared lyrics" : "");
  return makeShareMetadata({ title, description: data.description, path: "/s/" + share.slug, image: entityOgImagePath("share", share.slug), alt: "Sakura — " + cleanPreviewText(data.title, 160), indexable: false });
}
