"use client";

import { useEffect, useMemo, useState } from "react";
import { CollectionDetail, DetailTrack } from "@/components/CollectionDetail";

/**
 * A playlist Sakura put together — charts, moods, the seasonal ones.
 *
 * Distinguished from a mix (generated from *your* listening) and from your own
 * playlists (which you can edit) by the provenance line and by having no verbs.
 * See <CollectionDetail> for why that distinction is the point of this page.
 */

interface SystemPlaylist {
  id: string;
  name: string;
  description?: string | null;
  coverUrl?: string | null;
  tracks: DetailTrack[];
}

export default function SystemPlaylistClient({ id }: { id: string }) {
  const [playlist, setPlaylist] = useState<SystemPlaylist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/system-playlists/${id}`);
        if (res.status === 404) throw new Error("not-found");
        if (!res.ok) throw new Error("failed");
        const data: SystemPlaylist = await res.json();
        if (!cancelled) setPlaylist(data);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message === "not-found"
            ? "This playlist isn't available any more."
            : "We couldn't load this playlist. Check your connection and try again."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  const covers = useMemo(
    () => (playlist?.coverUrl ? [playlist.coverUrl] : []),
    [playlist?.coverUrl]
  );

  return (
    <CollectionDetail
      eyebrow="Playlist"
      title={playlist?.name ?? "Playlist"}
      description={playlist?.description}
      coverUrls={covers}
      tracks={playlist?.tracks ?? []}
      provenance="Curated by Sakura"
      backFallback="/home"
      loading={loading}
      error={error}
      onRetry={() => setReloadKey((k) => k + 1)}
      // Curated running order — the sequence is the editorial decision, so the
      // numbers mean something here in a way they don't on a mix.
      numbered
      empty={{
        title: "This playlist is empty",
        body: "There's nothing in here we can play right now. Try one of the others on your home screen.",
        action: { href: "/home", label: "Back to home" },
      }}
    />
  );
}
