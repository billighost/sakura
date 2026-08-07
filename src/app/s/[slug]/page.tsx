import type { Metadata } from "next";
import { notFound } from "next/navigation";
import prisma from "@/lib/db";
import { ShareClientPage } from "./ClientPage";

/**
 * Public share page.
 *
 * Served at `/s/<slug>` — the link people actually open. Metadata is
 * customised per share kind so a lyric card dropped into iMessage renders a
 * proper inline preview rather than a bare link.
 */

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  const share = await prisma.share.findUnique({
    where: { slug },
    select: {
      kind: true,
      payload: true,
      targetId: true,
      user: { select: { username: true } },
    },
  });

  if (!share) return { title: "Share not found" };

  const p = share.payload as Record<string, unknown>;

  if (share.kind === "lyric") {
    const track = (p.track as Record<string, string>) ?? {};
    const lines = (p.lines as string[]) ?? [];
    const excerpt = lines.slice(0, 3).join(" · ");
    return {
      title: `${track.title ?? "Lyric"} – ${track.artist ?? ""}`,
      description: excerpt || `${share.user.username} shared a lyric on Sakura`,
      openGraph: {
        title: `"${excerpt.slice(0, 100)}"`,
        description: `${track.title} – ${track.artist}`,
        type: "article",
      },
    };
  }

  if (share.kind === "track") {
    const track = (p.track as Record<string, string>) ?? {};
    return {
      title: `${track.title ?? "Song"} – ${track.artist ?? ""}`,
      description: `${share.user.username} shared a song on Sakura`,
      openGraph: {
        title: `${track.title} – ${track.artist}`,
        description: "Listen on Sakura",
        type: "music.song",
      },
    };
  }

  return {
    title: `${share.user.username} shared on Sakura`,
    description: "Listen on Sakura",
  };
}

export default async function SharePage({ params }: Props) {
  const { slug } = await params;

  const share = await prisma.share.findUnique({
    where: { slug },
    select: {
      id: true,
      kind: true,
      payload: true,
      targetId: true,
      theme: true,
      user: { select: { username: true } },
    },
  });

  if (!share) notFound();

  // Increment view count in the background — no reason to block the page for it.
  prisma.share.update({ where: { id: share.id }, data: { views: { increment: 1 } } }).catch(() => {});

  const p = share.payload as Record<string, unknown>;
  const track = (p.track as Record<string, string> | undefined) ?? {};
  const lines = (Array.isArray(p.lines) ? p.lines.filter((l: unknown): l is string => typeof l === "string") : []);
  const lyricTime = typeof p.lyricTime === "number" ? p.lyricTime : undefined;

  return (
    <ShareClientPage
      kind={share.kind}
      track={{
        id: share.targetId ?? track.id ?? "",
        title: track.title ?? "Unknown",
        artist: track.artist ?? "Unknown",
        album: track.album,
        coverUrl: track.coverUrl,
      }}
      lines={lines}
      lyricTime={lyricTime}
      theme={share.theme}
      sharedBy={share.user.username}
    />
  );
}
