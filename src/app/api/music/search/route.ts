import { NextRequest, NextResponse } from "next/server";

interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  preview: string;
  artist: { id: number; name: string };
  album: { id: number; title: string; cover_medium: string };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  const limit = Math.min(25, Math.max(1, parseInt(searchParams.get("limit") || "10")));

  if (!q || q.trim().length === 0) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://api.deezer.com/search?q=${encodeURIComponent(q.trim())}&limit=${limit}`,
      { next: { revalidate: 300 } }
    );
    const data = await res.json();

    const tracks = (data.data || []).map((t: DeezerTrack) => ({
      id: `deezer-${t.id}`,
      title: t.title,
      artist: t.artist.name,
      album: t.album.title,
      coverUrl: t.album.cover_medium,
      duration: t.duration,
      preview: t.preview,
      source: "deezer" as const,
    }));

    return NextResponse.json({ tracks, total: data.total || 0 });
  } catch (error) {
    console.error("[Deezer Search]", error);
    return NextResponse.json(
      { error: "Failed to search music" },
      { status: 500 }
    );
  }
}
