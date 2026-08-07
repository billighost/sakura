"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

/**
 * Taste onboarding.
 *
 * Three short steps, in deliberate order:
 *   1. Genres  — broad, fast, and something everyone can answer.
 *   2. Artists — narrower, and filtered by the genres just chosen so the grid
 *                is relevant rather than a wall of random names.
 *   3. Discovery — one slider, because "how adventurous are you" is genuinely
 *                  useful for scoring and can't be inferred on day one.
 *
 * Skippable at every step. A skipped onboarding still leaves a usable profile
 * — the engine falls back to popularity and learns from behaviour instead.
 */

type Genre = { id: string; label: string; emoji: string };
type Artist = { id: string; name: string; imageUrl: string | null; trackCount: number; genres: string[] };

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/taste/seeds")
      .then((r) => r.json())
      .then((data) => {
        setGenres(data.genres ?? []);
        setArtists(data.artists ?? []);
      })
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

  async function submit(skipped = false) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/taste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genres: skipped ? [] : Array.from(selectedGenres),
          artistIds: skipped ? [] : Array.from(selectedArtists),
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
      router.replace("/home");
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Something went wrong");
      setSubmitting(false);
    }
  }

  // Artists matching the chosen genres float to the top, so step 2 visibly
  // responds to step 1. Non-matching artists stay in the list rather than
  // being filtered out — a sparse catalogue would otherwise show an empty grid.
  const sortedArtists = useMemo(() => {
    if (selectedGenres.size === 0) return artists;
    return [...artists].sort((a, b) => {
      const aMatch = a.genres?.some((g) => selectedGenres.has(g)) ? 1 : 0;
      const bMatch = b.genres?.some((g) => selectedGenres.has(g)) ? 1 : 0;
      return bMatch - aMatch;
    });
  }, [artists, selectedGenres]);

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
              <div className={styles.grid}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className={`${styles.chip} skeleton`} style={{ height: "3rem" }} />
                ))}
              </div>
            ) : (
              <div className={styles.grid}>
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
                onClick={() => setStep(1)}
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

            <div className={styles.artistGrid}>
              {sortedArtists.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`${styles.artistCard} ${selectedArtists.has(a.id) ? styles.artistActive : ""}`}
                  onClick={() => toggleArtist(a.id)}
                  aria-pressed={selectedArtists.has(a.id)}
                >
                  <div className={styles.artistAvatarWrap}>
                    {a.imageUrl ? (
                      <img src={a.imageUrl} alt="" className={styles.artistAvatar} />
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
              {sortedArtists.length === 0 && !loading && (
                <p className={styles.empty}>
                  Your library is still filling up — we'll learn from what you play instead.
                </p>
              )}
            </div>

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
