import type { Metadata } from "next";
import { notFound } from "next/navigation";
import prisma from "@/lib/db";
import { auth } from "@/lib/auth";
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

/**
 * `instant = false` — this route is allowed to block, for now.
 *
 * Under Cache Components, awaiting `params` and then querying the database in
 * the page body is uncached runtime data outside `<Suspense>`, which fails
 * prerender validation. Converting it properly means splitting the page into a
 * prerenderable shell plus a suspended data child; until that happens this
 * opt-out keeps the route building and serving exactly as before.
 *
 * It does not force the route dynamic — a genuinely prerenderable route still
 * ships a static shell. See docs/01-app/02-guides/migrating-to-cache-components.
 */
export const instant = false;

import { Suspense } from "react";

async function ShareContent({ slug }: { slug: string }) {
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

  // A share is public by design, so most viewers here are signed out. The page
  // reads the session purely so the call-to-action can tell them which of the
  // two things it's about to do, rather than bouncing them to an unexplained
  // login screen.
  const session = await auth();

  return (
    <ShareClientPage
      kind={share.kind}
      isSignedIn={!!session?.user}
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

export default function SharePage({ params }: Props) {
  return (
    <Suspense fallback={<div />}>
      {params.then(({ slug }) => (
        <ShareContent slug={slug} />
      ))}
    </Suspense>
  );
}

