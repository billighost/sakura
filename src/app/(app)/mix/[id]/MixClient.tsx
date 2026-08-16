"use client";

import { useEffect, useMemo, useState } from "react";
import { CollectionDetail, DetailTrack } from "@/components/CollectionDetail";

/**
 * A mix — songs picked from your listening.
 *
 * Was a verbatim copy of the system-playlist page, which was a verbatim copy of
 * the playlist page: three files, three identical 555-line stylesheets, differing
 * in one fetch URL and one word of label. The shape is now shared; what's left
 * here is what a mix actually is.
 *
 * The old page's empty state read "Add some tracks to get this playlist started"
 * with an "Add tracks" button. You cannot add tracks to a mix — it's generated —
 * so the button opened a dialog that only offered "Close". A mix with no songs
 * means the taste engine hasn't got enough to work with yet, and the way forward
 * is to go and listen to something.
 */

interface Mix {
  id: string;
  name: string;
  description?: string | null;
  coverUrl?: string | null;
  tracks: DetailTrack[];
}

export default function MixClient({ id }: { id: string }) {
  const [mix, setMix] = useState<Mix | null>(null);
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
        const res = await fetch(`/api/mixes/${id}`);
        if (res.status === 404) throw new Error("not-found");
        if (!res.ok) throw new Error("failed");
        const data: Mix = await res.json();
        if (!cancelled) setMix(data);
      } catch (err) {
        // The old version was `.then(r => r.json())` with no status check, so a
        // 404 body became the mix and the render read `.tracks.length` off it.
        if (cancelled) return;
        setError(
          err instanceof Error && err.message === "not-found"
            ? "This mix isn't around any more. Mixes are rebuilt as you listen, so there'll be a new one on your home screen."
            : "We couldn't load this mix. Check your connection and try again."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  // Read out first: the React Compiler can't preserve a memo whose dependency
  // is an optional chain, because `mix?.coverUrl` narrows less specifically than
  // the value the closure actually reads.
  const coverUrl = mix?.coverUrl;
  const covers = useMemo(() => (coverUrl ? [coverUrl] : []), [coverUrl]);

  return (
    <CollectionDetail
      eyebrow="Mix"
      title={mix?.name ?? "Mix"}
      description={mix?.description}
      coverUrls={covers}
      tracks={mix?.tracks ?? []}
      provenance="Made for you — rebuilt as you listen"
      backFallback="/home"
      loading={loading}
      error={error}
      onRetry={() => setReloadKey((k) => k + 1)}
      // A mix has no meaningful position: it's an unordered selection, so a
      // number beside each row would be an index pretending to be a rank.
      numbered={false}
      empty={{
        title: "Not enough to go on yet",
        body: "Mixes are built from what you play. Listen to a few songs and one will show up here.",
        action: { href: "/search", label: "Find something to play" },
      }}
    />
  );
}
