const MAX_RETAINED_ARTWORK = 72;

type RetainedArtwork = {
  image: HTMLImageElement;
  ready: Promise<void>;
};

const retainedArtwork = new Map<string, RetainedArtwork>();

/**
 * Keep recently used artwork decoded for the lifetime of the listening session.
 * This complements the HTTP cache: a newly opened player can paint from the
 * same decoded image instead of briefly presenting an empty image element.
 */
export function retainArtwork(src: string, priority = false) {
  if (typeof Image === "undefined") return Promise.resolve();
  const existing = retainedArtwork.get(src);
  if (existing) {
    retainedArtwork.delete(src);
    retainedArtwork.set(src, existing);
    if (priority) existing.image.fetchPriority = "high";
    return existing.ready;
  }

  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = priority ? "high" : "auto";
  const ready = new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => {
      void image.decode().catch(() => undefined).finally(resolve);
    }, { once: true });
    image.addEventListener("error", () => {
      retainedArtwork.delete(src);
      reject(new Error("Artwork could not be decoded"));
    }, { once: true });
  });
  retainedArtwork.set(src, { image, ready });
  image.src = src;

  while (retainedArtwork.size > MAX_RETAINED_ARTWORK) {
    const oldest = retainedArtwork.keys().next().value as string | undefined;
    if (!oldest) break;
    retainedArtwork.delete(oldest);
  }
  return ready;
}
