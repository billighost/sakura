"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PageHeader } from "@/components/PageHeader";
import { usePlayer } from "@/components/PlayerContext";
import {
  AlbumIcon,
  CheckIcon,
  CheckCircleIcon,
  ClockIcon,
  CloseIcon,
  DownloadIcon,
  LinkIcon,
  MusicNoteIcon,
  PlaylistIcon,
  SpinnerIcon,
  TrashIcon,
} from "@/components/Icons";
import { haptic } from "@/lib/haptics";
import styles from "./page.module.css";

/**
 * Import from a link.
 *
 * ── What this screen used to be ─────────────────────────────────────────────
 *
 * A four-step progress rail that never advanced correctly (its state machine was
 * an effect racing itself), two big platform cards that did nothing when tapped,
 * a fake progress bar that crept up by `Math.random() * 10` every 300ms, and a
 * fixed-height track list that overflowed its container on a phone. It also
 * wrote its own inline SVGs and referenced the legacy `--sakura-*` tokens, so it
 * didn't inherit anything the rest of the app had learned about spacing, type or
 * theming.
 *
 * ── What it is now ──────────────────────────────────────────────────────────
 *
 * One column, three honest states: paste, review, done. No step rail — there are
 * only ever two decisions (which link, which tracks), and a four-dot indicator
 * over two decisions is decoration that has to be kept in sync. Progress is only
 * shown where it's real: resolving a link is indeterminate, so it says so, and
 * saving reports the count it actually has.
 *
 * The link goes to `/api/import/link`, which resolves it through the fallback
 * chain in `lib/importLink.ts` — Spotify *and* Deezer, tracks, albums, playlists,
 * share-sheet short links, with our own catalogue as the backstop. The field
 * used to go straight at Spotify's playlist API and reject everything else.
 */

interface ImportedTrack {
  title: string;
  artist: string;
  duration: number;
  coverUrl?: string;
  messageId: number;
  status: "pending" | "saved" | "exists" | "error";
  selected: boolean;
}

interface ResolvedPayload {
  name: string;
  coverUrl?: string;
  provider: "spotify" | "deezer";
  kind: "track" | "album" | "playlist";
  engine: string;
  tracks: {
    title: string;
    artist: string;
    duration: number;
    coverUrl?: string;
    messageId?: number;
  }[];
}

interface HistoryItem {
  url: string;
  name: string;
  count: number;
  at: number;
  provider?: string;
  kind?: string;
}

const HISTORY_KEY = "sakura-import-history";
const HISTORY_MAX = 8;

/* ── Recent-imports store ───────────────────────────────────────────────────
 *
 * `useSyncExternalStore` rather than a mount effect that mirrors localStorage
 * into state — the house pattern, for the reasons written up in
 * lib/usePersistedChoice.ts: no double render, validation on read, and other
 * tabs stay in step through the `storage` event.
 *
 * The one wrinkle over that helper is that this value is an *array*, and
 * `getSnapshot` has to return a referentially stable one or React re-renders
 * forever. So the parse is cached against the raw string it came from: same text
 * in, same array out.
 */
const EMPTY_HISTORY: HistoryItem[] = [];

let cachedRaw: string | null | undefined;
let cachedHistory: HistoryItem[] = EMPTY_HISTORY;
const historyListeners = new Set<() => void>();

function readHistory(): HistoryItem[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(HISTORY_KEY);
  } catch {
    raw = null;
  }

  if (raw === cachedRaw) return cachedHistory;
  cachedRaw = raw;

  try {
    const parsed = raw ? JSON.parse(raw) : null;
    cachedHistory = Array.isArray(parsed)
      ? parsed.filter(
          (h): h is HistoryItem => Boolean(h) && typeof h.url === "string" && h.url.length > 0
        )
      : EMPTY_HISTORY;
  } catch {
    // Written by an older build, or corrupted. Treat it as absent.
    cachedHistory = EMPTY_HISTORY;
  }

  return cachedHistory;
}

function writeHistory(next: HistoryItem[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Private mode. The list is a convenience, not state anything depends on.
  }
  // Invalidate the parse cache and tell this tab — `storage` only fires in others.
  cachedRaw = undefined;
  for (const listener of historyListeners) listener();
}

function subscribeHistory(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === HISTORY_KEY) {
      cachedRaw = undefined;
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  historyListeners.add(onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    historyListeners.delete(onChange);
  };
}

/** The server has no per-device history, so it renders none and hydrates in. */
function getServerHistory(): HistoryItem[] {
  return EMPTY_HISTORY;
}

/** Recognises what we can resolve, so the field can say before you submit. */
function looksImportable(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/^spotify:(track|album|playlist):[A-Za-z0-9]+$/i.test(v)) return true;
  if (/^[A-Za-z0-9]{22}$/.test(v)) return true;
  return /(open\.spotify\.com|spotify\.link|deezer\.com|link\.deezer\.com|dzr\.page\.link)/i.test(v);
}

function providerOf(value: string): "spotify" | "deezer" | null {
  if (/spotify/i.test(value)) return "spotify";
  if (/deezer|dzr\.page\.link/i.test(value)) return "deezer";
  return null;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatWhen(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString();
}

export default function ImportPage() {
  const { showToast } = usePlayer();

  const [url, setUrl] = useState("");
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [source, setSource] = useState<ResolvedPayload | null>(null);
  const [tracks, setTracks] = useState<ImportedTrack[]>([]);
  const history = useSyncExternalStore(subscribeHistory, readHistory, getServerHistory);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // A request left running after the page unmounts has nowhere to deliver to.
  useEffect(() => () => abortRef.current?.abort(), []);

  const valid = looksImportable(url);
  const provider = providerOf(url);

  const rememberImport = useCallback((item: HistoryItem) => {
    const previous = readHistory();
    writeHistory([item, ...previous.filter((h) => h.url !== item.url)].slice(0, HISTORY_MAX));
  }, []);

  const resolve = useCallback(
    async (link: string) => {
      const target = link.trim();
      if (!target || resolving) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setResolving(true);
      setError(null);
      setSavedCount(null);
      setSource(null);
      setTracks([]);

      try {
        const res = await fetch("/api/import/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: target }),
          signal: controller.signal,
        });
        const data = await res.json();

        if (!res.ok) {
          setError(
            typeof data?.error === "string"
              ? data.error
              : "Couldn't read that link. Check it and try again."
          );
          haptic("error");
          return;
        }

        const payload = data as ResolvedPayload;
        setSource(payload);
        setTracks(
          payload.tracks.map((t) => ({
            title: t.title,
            artist: t.artist,
            duration: t.duration || 0,
            coverUrl: t.coverUrl,
            messageId: t.messageId ?? 0,
            status: "pending" as const,
            selected: true,
          }))
        );
        rememberImport({
          url: target,
          name: payload.name,
          count: payload.tracks.length,
          at: Date.now(),
          provider: payload.provider,
          kind: payload.kind,
        });
        haptic("success");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Couldn't reach the import service. Check your connection and try again.");
        haptic("error");
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setResolving(false);
      }
    },
    [resolving, rememberImport]
  );

  const selected = useMemo(
    () => tracks.filter((t) => t.selected && t.status === "pending"),
    [tracks]
  );
  const allSelected = tracks.length > 0 && tracks.every((t) => t.selected);

  const save = useCallback(async () => {
    if (selected.length === 0 || saving) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/import/spotify/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tracks: selected.map((t) => ({
            title: t.title,
            artist: t.artist,
            duration: t.duration,
            messageId: t.messageId,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Save failed");

      /*
       * Statuses come back per track, in the order they were sent — the route
       * loops the array and pushes one result per entry — so they are matched by
       * position, with the title as a sanity check. Matching on title alone would
       * collide on a playlist that legitimately contains the same song twice.
       *
       * The old version called setProgress() *inside* a setState updater, which
       * React runs during render, and then reported a percentage derived from a
       * counter it had already discarded.
       */
      const results = (data.results ?? []) as { title?: string; status?: string }[];

      let saved = 0;
      let cursor = 0;
      setTracks((prev) =>
        prev.map((t) => {
          if (!t.selected || t.status !== "pending") return t;

          const row = results[cursor++];
          const status = row && (!row.title || row.title === t.title) ? row.status : undefined;

          const resolvedStatus: ImportedTrack["status"] =
            status === "created" || status === "saved"
              ? "saved"
              : status === "exists"
                ? "exists"
                : "error";

          if (resolvedStatus !== "error") saved += 1;
          return { ...t, status: resolvedStatus, selected: false };
        })
      );

      setSavedCount(saved);
      haptic(saved > 0 ? "success" : "error");
      if (saved > 0) showToast(`Added ${saved} track${saved === 1 ? "" : "s"} to your library`, "success");
    } catch {
      setError("Couldn't save these to your library. Try again in a moment.");
      haptic("error");
    } finally {
      setSaving(false);
    }
  }, [selected, saving, showToast]);

  const reset = useCallback(() => {
    setUrl("");
    setSource(null);
    setTracks([]);
    setSavedCount(null);
    setError(null);
    inputRef.current?.focus();
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text?.trim()) return;
      setUrl(text.trim());
      haptic("selection");
      // Straight through: the user asked for the clipboard's link, so making
      // them tap Import as well is a step for nothing.
      if (looksImportable(text)) void resolve(text);
    } catch {
      // Clipboard read refused — the field is still there to type into.
      inputRef.current?.focus();
    }
  }, [resolve]);

  const failedCount = tracks.filter((t) => t.status === "error").length;
  const doneCount = tracks.filter((t) => t.status === "saved" || t.status === "exists").length;

  return (
    <div className={styles.page} data-page-scroll>
      <PageHeader title="Import" eyebrow="Library" backFallback="/library" />

      <div className={styles.body}>
        <p className={styles.lede}>
          Paste a link to a song, album or playlist from Spotify or Deezer and pick
          what you want to keep.
        </p>

        {/* ── Paste ─────────────────────────────────────────────────────── */}
        <div className={styles.field}>
          <div
            className={styles.inputWrap}
            data-state={url.trim() ? (valid ? "valid" : "invalid") : undefined}
          >
            <span className={styles.inputIcon} aria-hidden="true">
              <LinkIcon size={16} />
            </span>
            <input
              ref={inputRef}
              className={styles.input}
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Paste a Spotify or Deezer link"
              aria-label="Link to import"
              aria-invalid={url.trim() ? !valid : undefined}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valid) void resolve(url);
              }}
            />
            {url.trim() ? (
              <>
                {/* Names what we recognised, so a mistyped host is obvious
                    before the request rather than after it. */}
                {provider && (
                  <span className={styles.providerTag}>
                    {provider === "spotify" ? "Spotify" : "Deezer"}
                  </span>
                )}
                <button
                  type="button"
                  className={styles.inputBtn}
                  onClick={() => {
                    setUrl("");
                    inputRef.current?.focus();
                  }}
                  aria-label="Clear the link"
                >
                  <CloseIcon size={15} />
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.inputBtn}
                onClick={pasteFromClipboard}
                aria-label="Paste from clipboard"
              >
                Paste
              </button>
            )}
          </div>

          <button
            type="button"
            className={`${styles.submit} pressable`}
            onClick={() => void resolve(url)}
            disabled={!valid || resolving}
          >
            {resolving ? (
              <>
                <SpinnerIcon size={16} className={styles.spin} />
                Reading the link…
              </>
            ) : (
              <>
                <DownloadIcon size={16} />
                Find the tracks
              </>
            )}
          </button>

          {/* Said once, at the point of doubt, instead of a three-step
              "How to import" panel repeating what the field already implies. */}
          {url.trim() && !valid && (
            <p className={styles.hint}>
              That isn&rsquo;t a link we can read. Use the Share → Copy link option in
              Spotify or Deezer.
            </p>
          )}
          {!url.trim() && !source && (
            <p className={styles.hint}>
              Works with songs, albums and playlists — including the short links the
              mobile apps hand out.
            </p>
          )}
        </div>

        {error && (
          <div className={styles.error} role="alert">
            <span className={styles.errorIcon} aria-hidden="true">
              <CloseIcon size={14} />
            </span>
            <p>{error}</p>
            <button
              type="button"
              className={styles.errorDismiss}
              onClick={() => setError(null)}
              aria-label="Dismiss"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        )}

        {/* ── Review ────────────────────────────────────────────────────── */}
        {source && tracks.length > 0 && (
          <section className={styles.result} aria-label="Tracks found">
            <header className={styles.resultHead}>
              {source.coverUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img className={styles.resultCover} src={source.coverUrl} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className={styles.resultCover} data-placeholder>
                  {source.kind === "album" ? <AlbumIcon size={20} /> : <PlaylistIcon size={20} />}
                </span>
              )}
              <div className={styles.resultText}>
                <h2 className={styles.resultName}>{source.name}</h2>
                <p className={styles.resultMeta}>
                  {tracks.length} track{tracks.length === 1 ? "" : "s"}
                  {" · "}
                  {source.kind}
                  {" · "}
                  {source.provider === "spotify" ? "Spotify" : "Deezer"}
                </p>
              </div>
            </header>

            <div className={styles.resultTools}>
              <button
                type="button"
                className={styles.toolBtn}
                onClick={() =>
                  setTracks((prev) => prev.map((t) => ({ ...t, selected: !allSelected })))
                }
                aria-pressed={allSelected}
              >
                {allSelected ? "Clear all" : "Select all"}
              </button>
              <span className={styles.toolCount}>
                {selected.length} selected
                {doneCount > 0 && ` · ${doneCount} in your library`}
                {failedCount > 0 && ` · ${failedCount} failed`}
              </span>
            </div>

            {/*
              Scrolls inside itself with a viewport-relative cap, and each row is
              a real flex layout with `min-width: 0` on the text — the old list
              had a fixed pixel height and no min-width, so long titles pushed
              the duration and status dots off the right edge.
            */}
            <ul className={styles.trackList} data-lenis-prevent>
              {tracks.map((track, i) => {
                const locked = track.status !== "pending";
                return (
                  <li key={`${track.title}-${track.artist}-${i}`} className={styles.trackRow}>
                    <label className={styles.trackPick}>
                      <input
                        type="checkbox"
                        className={styles.checkbox}
                        checked={track.selected}
                        disabled={locked || saving}
                        onChange={() =>
                          setTracks((prev) =>
                            prev.map((t, j) => (i === j ? { ...t, selected: !t.selected } : t))
                          )
                        }
                        aria-label={`Include ${track.title}`}
                      />
                      <span className={styles.checkboxBox} aria-hidden="true">
                        <CheckIcon size={12} />
                      </span>
                    </label>

                    {track.coverUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img className={styles.trackCover} src={track.coverUrl} alt="" referrerPolicy="no-referrer" />
                    ) : (
                      <span className={styles.trackCover} data-placeholder>
                        <MusicNoteIcon size={14} />
                      </span>
                    )}

                    <span className={styles.trackText}>
                      <span className={styles.trackTitle}>{track.title}</span>
                      <span className={styles.trackArtist}>{track.artist}</span>
                    </span>

                    {track.duration > 0 && (
                      <span className={styles.trackTime}>{formatDuration(track.duration)}</span>
                    )}

                    <span className={styles.trackState} data-status={track.status}>
                      {track.status === "saved" && <CheckCircleIcon size={16} />}
                      {track.status === "exists" && <ClockIcon size={15} />}
                      {track.status === "error" && <CloseIcon size={14} />}
                    </span>
                  </li>
                );
              })}
            </ul>

            {savedCount === null ? (
              <button
                type="button"
                className={`${styles.submit} pressable`}
                onClick={() => void save()}
                disabled={selected.length === 0 || saving}
              >
                {saving ? (
                  <>
                    <SpinnerIcon size={16} className={styles.spin} />
                    Adding to your library…
                  </>
                ) : (
                  `Add ${selected.length} track${selected.length === 1 ? "" : "s"}`
                )}
              </button>
            ) : (
              <div className={styles.done}>
                <span className={styles.doneIcon}>
                  <CheckIcon size={18} />
                </span>
                <p className={styles.doneText}>
                  {savedCount > 0
                    ? `${savedCount} track${savedCount === 1 ? "" : "s"} added to your library.`
                    : "Nothing new to add — these were already in your library."}
                </p>
                <button type="button" className={`${styles.secondary} pressable`} onClick={reset}>
                  Import something else
                </button>
              </div>
            )}
          </section>
        )}

        {/* ── Recent ────────────────────────────────────────────────────── */}
        {!source && history.length > 0 && (
          <section className={styles.recent} aria-label="Recent imports">
            <div className={styles.recentHead}>
              <h2 className={styles.recentTitle}>Recent</h2>
              <button
                type="button"
                className={styles.toolBtn}
                onClick={() => writeHistory(EMPTY_HISTORY)}
              >
                <TrashIcon size={13} />
                Clear
              </button>
            </div>

            <ul className={styles.recentList}>
              {history.map((item) => (
                <li key={item.url}>
                  <button
                    type="button"
                    className={`${styles.recentItem} pressable`}
                    onClick={() => {
                      setUrl(item.url);
                      void resolve(item.url);
                    }}
                  >
                    <span className={styles.recentIcon} aria-hidden="true">
                      {item.kind === "album" ? (
                        <AlbumIcon size={16} />
                      ) : item.kind === "track" ? (
                        <MusicNoteIcon size={16} />
                      ) : (
                        <PlaylistIcon size={16} />
                      )}
                    </span>
                    <span className={styles.recentText}>
                      <span className={styles.recentName}>{item.name || item.url}</span>
                      <span className={styles.recentMeta}>
                        {item.count} track{item.count === 1 ? "" : "s"} · {formatWhen(item.at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
