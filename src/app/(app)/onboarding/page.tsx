"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

/**
 * Taste onboarding.
 *
 * Three short steps, in deliberate order:
 *   1. Genres  — broad, fast, and something everyone can answer.
 *   2. Artists — fetched *for* the genres just chosen, from the provider rather
 *                than our own catalogue. See `/api/taste/artists` for why.
 *   3. Discovery — one slider, because "how adventurous are you" is genuinely
 *                  useful for scoring and can't be inferred on day one.
 *
 * Skippable at every step. A skipped onboarding still leaves a usable profile
 * — the engine falls back to popularity and learns from behaviour instead.
 */

type Genre = { id: string; label: string; emoji: string };
type Artist = {
  id: string;
  deezerId: number;
  name: string;
  imageUrl: string | null;
  genres: string[];
};

const MIN_GENRES = 3;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(new Set());
  const [selectedArtists, setSelectedArtists] = useState<Set<string>>(new Set());
  const [discovery, setDiscovery] = useState(0.35);
  const [loading, setLoading] = useState(true);
  const [loadingArtists, setLoadingArtists] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/taste/seeds")
      .then((r) => r.json())
      .then((data) => setGenres(data.genres ?? []))
      .catch(() => setError("Couldn't load choices. You can skip this for now."))
      .finally(() => setLoading(false));
  }, []);

  const toggleGenre = useCallback((id: string) => {
    setSelectedGenres((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleArtist = useCallback((id: string) => {
    setSelectedArtists((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  /*
   * Artists depend on the genre picks, so they can't be fetched up front with
   * the genres. Keyed by the sorted genre list: going back to step 1, changing
   * nothing and continuing again shouldn't re-fetch, but changing a genre
   * should.
   */
  const artistsKey = useRef<string>("");

  const loadArtists = useCallback(async (picked: Set<string>) => {
    const key = Array.from(picked).sort().join(",");
    if (!key || key === artistsKey.current) return;
    artistsKey.current = key;

    setLoadingArtists(true);
    try {
      const res = await fetch("/api/taste/artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genres: Array.from(picked) }),
      });
      const data = await res.json();
      const next: Artist[] = Array.isArray(data.artists) ? data.artists : [];
      setArtists(next);
      // Drop picks that are no longer on offer after a genre change, so a
      // hidden selection can't be submitted.
      setSelectedArtists((prev) => {
        const ids = new Set(next.map((a) => a.id));
        return new Set(Array.from(prev).filter((id) => ids.has(id)));
      });
    } catch {
      // Leave the grid empty — step 2 is optional and has an empty state. The
      // key is deliberately left set so a retry happens on the next change
      // rather than on every render.
      setArtists([]);
    } finally {
      setLoadingArtists(false);
    }
  }, []);

  /*
   * Warm the fetch as soon as the picks are valid, so Continue usually lands on
   * a populated grid. `loadArtists` no-ops when the genre set hasn't changed, so
   * this costs one request per distinct selection rather than one per toggle.
   */
  useEffect(() => {
    if (step !== 0 || selectedGenres.size < MIN_GENRES) return;
    const t = setTimeout(() => loadArtists(selectedGenres), 400);
    return () => clearTimeout(t);
  }, [step, selectedGenres, loadArtists]);

  async function submit(skipped = false) {
    setSubmitting(true);
    setError(null);
    try {
      // Names travel with the ids: these artists don't exist in our DB yet, so
      // the server upserts them by name and can't resolve a `deezer-` id alone.
      const picked = artists.filter((a) => selectedArtists.has(a.id));

      const res = await fetch("/api/taste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genres: skipped ? [] : Array.from(selectedGenres),
          artists: skipped
            ? []
            : picked.map((a) => ({
                name: a.name,
                deezerId: a.deezerId,
                imageUrl: a.imageUrl,
                genres: a.genres,
              })),
          discovery: skipped ? 0.35 : discovery,
          // A skip still marks them onboarded — otherwise they'd be asked
          // again on every visit, which is worse than a cold-start profile.
          skipped,
        }),
      });

      if (!res.ok && !skipped) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Something went wrong");
      }

      // Kick mixes off now so the home page has something waiting.
      fetch("/api/home/mixes", { method: "POST" }).catch(() => {});

      /*
       * A hard navigation, not `router.replace`.
       *
       * The restart loop worked like this: visiting /home while un-onboarded
       * server-redirects to /onboarding, and the App Router caches that RSC
       * payload against the /home key. Finishing onboarding and calling
       * `router.replace("/home")` replayed the *cached* payload — the redirect
       * — putting the user straight back at step 1, forever. `router.refresh()`
       * afterwards couldn't help: by then the URL was already /onboarding
       * again, so it refreshed the onboarding page.
       *
       * Ordering refresh-then-replace doesn't reliably fix it either; the two
       * race, and the cached entry can still win. A full document load is the
       * only thing guaranteed to discard the client Router Cache, and it costs
       * one navigation on a once-per-account flow.
       */
      window.location.assign("/home");
    } catch (e: any) {
      setError(e.message || "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.bloom} aria-hidden="true" />

      <div className={styles.card}>
        <div className={styles.progressTrack} aria-hidden="true">
          <div className={styles.progressFill} style={{ width: `${((step + 1) / 3) * 100}%` }} />
        </div>

        {step === 0 && (
          <section className={styles.step}>
            <h1 className={styles.title}>What do you listen to?</h1>
            <p className={styles.subtitle}>
              Pick at least {MIN_GENRES}. This shapes your mixes and what plays when a queue runs out.
            </p>

            {loading ? (
              <div className={styles.grid} data-lenis-prevent>
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className={`${styles.chip} skeleton`} style={{ height: "3rem" }} />
                ))}
              </div>
            ) : (
              <div className={styles.grid} data-lenis-prevent>
                {genres.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={`${styles.chip} ${selectedGenres.has(g.id) ? styles.chipActive : ""}`}
                    onClick={() => toggleGenre(g.id)}
                    aria-pressed={selectedGenres.has(g.id)}
                  >
                    <span className={styles.chipEmoji} aria-hidden="true">{g.emoji}</span>
                    {g.label}
                  </button>
                ))}
              </div>
            )}

            <div className={styles.actions}>
              <button type="button" className={styles.skip} onClick={() => submit(true)} disabled={submitting}>
                Skip for now
              </button>
              <button
                type="button"
                className={styles.primary}
                onClick={() => {
                  // Usually already warmed by the prefetch effect; this covers
                  // the case where Continue is hit inside the debounce window.
                  loadArtists(selectedGenres);
                  setStep(1);
                }}
                disabled={selectedGenres.size < MIN_GENRES}
              >
                {selectedGenres.size < MIN_GENRES
                  ? `Pick ${MIN_GENRES - selectedGenres.size} more`
                  : "Continue"}
              </button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className={styles.step}>
            <h1 className={styles.title}>Any of these?</h1>
            <p className={styles.subtitle}>
              Optional — but picking a few gives your first mixes a real head start.
            </p>

            {loadingArtists ? (
              <div className={styles.artistGrid} data-lenis-prevent>
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className={styles.artistCard}>
                    <div className={styles.artistAvatarWrap}>
                      <div className={`${styles.artistAvatar} skeleton`} />
                    </div>
                    <span className={`${styles.artistName} skeleton`}>&nbsp;</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.artistGrid} data-lenis-prevent>
                {artists.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`${styles.artistCard} ${selectedArtists.has(a.id) ? styles.artistActive : ""}`}
                    onClick={() => toggleArtist(a.id)}
                    aria-pressed={selectedArtists.has(a.id)}
                  >
                    <div className={styles.artistAvatarWrap}>
                      {a.imageUrl ? (
                        <img src={a.imageUrl} alt="" className={styles.artistAvatar} referrerPolicy="no-referrer" />
                      ) : (
                        <div className={styles.artistFallback}>{a.name.slice(0, 1).toUpperCase()}</div>
                      )}
                      {selectedArtists.has(a.id) && (
                        <span className={styles.check} aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                      )}
                    </div>
                    <span className={styles.artistName}>{a.name}</span>
                  </button>
                ))}
                {artists.length === 0 && (
                  <p className={styles.empty}>
                    Couldn’t reach our music source just now — we’ll learn from what
                    you play instead.
                  </p>
                )}
              </div>
            )}

            <div className={styles.actions}>
              <button type="button" className={styles.skip} onClick={() => setStep(0)}>
                Back
              </button>
              <button type="button" className={styles.primary} onClick={() => setStep(2)}>
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className={styles.step}>
            <h1 className={styles.title}>How adventurous?</h1>
            <p className={styles.subtitle}>
              When a queue runs dry, we keep playing. This sets how far we'll stray from what you know.
            </p>

            <div className={styles.sliderBlock}>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(discovery * 100)}
                onChange={(e) => setDiscovery(Number(e.target.value) / 100)}
                className={styles.slider}
                aria-label="Discovery level"
              />
              <div className={styles.sliderLabels}>
                <span>Familiar</span>
                <span>Surprise me</span>
              </div>
              <p className={styles.sliderHint}>
                {discovery < 0.3
                  ? "Mostly artists and songs you already love."
                  : discovery < 0.6
                    ? "A steady mix of favourites and new finds."
                    : "Heavy on music you've never heard before."}
              </p>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              <button type="button" className={styles.skip} onClick={() => setStep(1)} disabled={submitting}>
                Back
              </button>
              <button
                type="button"
                className={styles.primary}
                onClick={() => submit(false)}
                disabled={submitting}
              >
                {submitting ? "Building your mixes…" : "Finish"}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
