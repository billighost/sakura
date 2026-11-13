"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { CollectionSearchIndex, collectionSearchWords } from "./collectionSearch";
import type { MusicTrack } from "./types";

/** Keep input/IME urgent, and never retain results from different membership. */
export function useCollectionSearch(tracks: MusicTrack[], query: string) {
  const deferredQuery = useDeferredValue(query);
  const words = useMemo(() => collectionSearchWords(deferredQuery), [deferredQuery]);
  const key = words.join("\0");
  const [index] = useState(() => new CollectionSearchIndex());
  const [result, setResult] = useState<{ source: MusicTrack[]; key: string; tracks: MusicTrack[] } | null>(null);
  const [failure, setFailure] = useState<{ source: MusicTrack[]; key: string; error: unknown } | null>(null);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    void index.filter(tracks, words, { signal: controller.signal }).then(matches => {
      if (!controller.signal.aborted) setResult({ source: tracks, key, tracks: matches.length === tracks.length ? tracks : matches });
    }).catch(error => {
      if (!controller.signal.aborted) setFailure({ source: tracks, key, error });
    });
    return () => controller.abort();
  }, [tracks, key, words, index]);

  // Let the screen error boundary own an unexpected indexing failure.
  if (key && failure?.source === tracks && failure.key === key) throw failure.error;

  const sameMembership = result?.source === tracks;
  const ready = sameMembership && result.key === key;
  return {
    tracks: !key ? tracks : sameMembership ? result.tracks : tracks,
    searching: collectionSearchWords(query).join("\0") !== key || Boolean(key && !ready),
  };
}
