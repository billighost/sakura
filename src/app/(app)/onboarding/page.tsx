"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { GENRES } from "@/lib/genres";
import { CheckIcon, SpinnerIcon, UserIcon } from "@/components/Icons";
import { haptic } from "@/lib/haptics";
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
 *
 * ── Why the genre step looks like this ──────────────────────────────────────
 *
 * The genre registry carries a drawn scene per genre — a DJ over a turntable, a
 * pianist at a keyboard, a flame — each with its own tone. This step used to
 * render them at 18px beside a label in a text chip, which is the one place in
 * the app those illustrations appear and the one place they were too small to
 * see. They're the tile now, and the label sits under them.
 *
 * Selection is still marked in accent pink rather than in each genre's own tone.
 * Tinting the tile by genre was the first idea and it's wrong twice: it spends
 * the accent's exclusive job on decoration, and across thirty different hues you
 * can no longer tell at a glance which ones you picked.
 *
 * ── Why the genre list isn't fetched ────────────────────────────────────────
 *
 * It used to come from `/api/taste/seeds`, which intersected a curated list
 * with `SELECT DISTINCT genre FROM Track/Artist` — so the picker only offered
 * genres we already held music for. On a young catalogue that cut ~30 genres
 * down to a handful, which is the wrong answer twice over: it made the app look
 * empty, and the filter was pointless anyway now that both the artist picker and
 * the mix pools are provider-backed. A genre we hold nothing for works fine.
 */

type Artist = {
  id: string;
  deezerId: number;
  name: string;
  imageUrl: string | null;
  genres: string[];
};

const MIN_GENRES = 3;
const STEPS = ["Sounds", "Artists", "Taste"] as const;

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(new Set());
  const [selectedArtists, setSelectedArtists] = useState<Set<string>>(new Set());
  const [discovery, setDiscovery] = useState(0.35);
  const [loadingArtists, setLoadingArtists] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleGenre = useCallback((id: string) => {
    haptic("selection");
    setSelectedGenres((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleArtist = useCallback((id: string) => {
    haptic("selection");
    setSelectedArtists((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
        throw new Error(data.error || "We couldn't save your picks.");
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
       *
       * The lint rule recommending router.push is right in general and wrong
       * here — push is precisely what caused the loop.
       */
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/home");
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? `${e.message} Check your connection and try again.`
          : "Something went wrong. Try again in a moment."
      );
      setSubmitting(false);
    }
  }

  const remaining = MIN_GENRES - selectedGenres.size;
  const artistCount = selectedArtists.size;

  const discoveryLabel = useMemo(
    () =>
      discovery < 0.3
        ? "Mostly artists and songs you already love."
        : discovery < 0.6
          ? "A steady mix of favourites and new finds."
          : "Heavy on music you've never heard before.",
    [discovery]
  );

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        {/*
          The step is named, not just counted. "Step 2 of 3" tells you how much
          is left; "Artists" tells you what you're about to be asked, which is
          the part that makes a three-step flow feel short rather than open-ended.
        */}
        <nav className={styles.progress} aria-label="Progress">
          {STEPS.map((label, i) => (
            <div
              key={label}
              className={`${styles.tick} ${i <= step ? styles.tickDone : ""}`}
              aria-current={i === step ? "step" : undefined}
            >
              <span className={styles.tickBar} />
              <span className={styles.tickLabel}>{label}</span>
            </div>
          ))}
        </nav>

        {step === 0 && (
          <section className={styles.step}>
            <header className={styles.head}>
              <h1 className={styles.title}>What do you listen to?</h1>
              <p className={styles.sub}>
                Pick at least {MIN_GENRES}. This shapes your mixes and what plays when a
                queue runs out.
              </p>
            </header>

            <div className={styles.genreGrid} data-lenis-prevent>
              {GENRES.map((g) => {
                const on = selectedGenres.has(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={`${styles.genre} ${on ? styles.genreOn : ""} pressable`}
                    onClick={() => toggleGenre(g.id)}
                    aria-pressed={on}
                  >
                    {/* `data-anim` is what Icons.module.css keys its per-part
                        keyframes off, so a selected tile's scene comes alive —
                        the turntable spins, the flame flickers. */}
                    <span className={styles.genreArt} data-anim={on ? "" : undefined}>
                      <g.Icon size={40} tone={g.tone} />
                    </span>
                    <span className={styles.genreLabel}>{g.label}</span>
                    {on && (
                      <span className={styles.genreCheck} aria-hidden="true">
                        <CheckIcon size={12} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <footer className={styles.actions}>
              <button
                type="button"
                className={`${styles.quiet} pressable`}
                onClick={() => submit(true)}
                disabled={submitting}
              >
                Skip
              </button>
              <button
                type="button"
                className={`${styles.primary} pressable`}
                onClick={() => {
                  // Usually already warmed by the prefetch effect; this covers
                  // the case where Continue is hit inside the debounce window.
                  loadArtists(selectedGenres);
                  setStep(1);
                }}
                disabled={remaining > 0}
              >
                {remaining > 0 ? `Pick ${remaining} more` : "Next"}
              </button>
            </footer>
          </section>
        )}

        {step === 1 && (
          <section className={styles.step}>
            <header className={styles.head}>
              <h1 className={styles.title}>Anyone you love?</h1>
              <p className={styles.sub}>
                Optional — but a few picks give your first mixes a real head start.
              </p>
            </header>

            <div className={styles.artistGrid} data-lenis-prevent>
              {loadingArtists
                ? Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className={styles.artist} aria-hidden="true">
                      <span className={`${styles.artistArt} skeleton`} />
                      <span className={`${styles.artistNameSkeleton} skeleton`} />
                    </div>
                  ))
                : artists.map((a) => {
                    const on = selectedArtists.has(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className={`${styles.artist} ${on ? styles.artistOn : ""} pressable`}
                        onClick={() => toggleArtist(a.id)}
                        aria-pressed={on}
                      >
                        <span className={styles.artistArt}>
                          {a.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={a.imageUrl}
                              alt=""
                              className={styles.artistImg}
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span className={styles.artistFallback}>
                              <UserIcon size={22} />
                            </span>
                          )}
                          {on && (
                            <span className={styles.artistCheck} aria-hidden="true">
                              <CheckIcon size={13} />
                            </span>
                          )}
                        </span>
                        <span className={styles.artistName}>{a.name}</span>
                      </button>
                    );
                  })}
            </div>

            {!loadingArtists && artists.length === 0 && (
              <p className={styles.empty}>
                We couldn&apos;t reach our music source just now. Skip ahead — Sakura
                will learn from what you play instead.
              </p>
            )}

            <footer className={styles.actions}>
              <button
                type="button"
                className={`${styles.quiet} pressable`}
                onClick={() => setStep(0)}
              >
                Back
              </button>
              <button
                type="button"
                className={`${styles.primary} pressable`}
                onClick={() => setStep(2)}
              >
                {/* Says what you've done, not just what's next. */}
                {artistCount > 0 ? `Next with ${artistCount}` : "Skip this bit"}
              </button>
            </footer>
          </section>
        )}

        {step === 2 && (
          <section className={styles.step}>
            <header className={styles.head}>
              <h1 className={styles.title}>How adventurous?</h1>
              <p className={styles.sub}>
                When a queue runs dry, Sakura keeps playing. This sets how far it strays
                from what you know.
              </p>
            </header>

            <div className={styles.sliderBlock}>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(discovery * 100)}
                onChange={(e) => setDiscovery(Number(e.target.value) / 100)}
                className={styles.slider}
                aria-label="How much new music to mix in"
                aria-valuetext={discoveryLabel}
              />
              <div className={styles.sliderEnds}>
                <span>Familiar</span>
                <span>Surprise me</span>
              </div>
              {/* aria-live so a change is announced: the visual feedback for
                  moving this slider is entirely in this sentence. */}
              <p className={styles.sliderHint} aria-live="polite">
                {discoveryLabel}
              </p>
            </div>

            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}

            <footer className={styles.actions}>
              <button
                type="button"
                className={`${styles.quiet} pressable`}
                onClick={() => setStep(1)}
                disabled={submitting}
              >
                Back
              </button>
              <button
                type="button"
                className={`${styles.primary} pressable`}
                onClick={() => submit(false)}
                disabled={submitting}
              >
                {submitting && <SpinnerIcon size={16} className={styles.spin} />}
                {submitting ? "Building your mixes…" : "Start listening"}
              </button>
            </footer>
          </section>
        )}
      </div>
    </main>
  );
}
