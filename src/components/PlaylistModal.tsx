"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./PlaylistModal.module.css";
import { usePlayer } from "./PlayerContext";
import { Sheet } from "./Sheet";
import { ChevronRightIcon, CloseIcon, HeartIcon, PlaylistIcon, PlusIcon } from "./Icons";

/**
 * Bring music in — the app's one import surface.
 *
 * Shape of the redesign, and why:
 *
 *   The old modal opened on a chooser ("create manually" / "import from a link"),
 *   which asked a question the user had already answered by tapping ＋. Behind it,
 *   a second screen crammed a paste field and the connected account together under
 *   an "or" divider, and the connection state was invisible until you got there —
 *   it called /check, then /playlists, and flashed the green Connect button in
 *   between. Three taps and two loading flashes before you saw anything of yours.
 *
 *   Now there is one source screen and it opens *onto your own library*: the
 *   account you're connected to, your playlists with their real artwork, and Liked
 *   Songs — the one collection that has no shareable URL and so can only be
 *   reached this way. Pasting a link stays at the top because it's the source that
 *   needs input, and it's the only one that works without connecting. Creating an
 *   empty playlist is a quiet line in the footer: it's the rare case, and it is
 *   always reachable without scrolling past the whole list.
 *
 *   The confirm step is a proof sheet rather than a list things vanish from.
 *   Removing a track strikes it through in place and the footer's count updates;
 *   nothing is hidden and the change never expires. That replaces a floating undo
 *   toast that covered the list and gave you five seconds to notice it.
 *
 * Spotify green appears exactly once per screen, on Spotify's own mark and its
 * connect button. The old design used it three times — a badge, an icon wash and
 * a button — which made a third party's colour read as Sakura's second accent.
 */

interface PlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (playlistId: string) => void;
  /**
   * Which screen to open on. `AddToPlaylistModal` passes "manual" — someone who
   * tapped "New Playlist" while adding a song wants to name a playlist, not
   * browse Spotify, and landing them on the import sources would be a detour.
   */
  startAt?: "sources" | "manual";
}

interface PreviewTrack {
  id: string;
  title: string;
  artist: string;
  duration: number;
  coverUrl: string;
}

interface SpotifyPlaylist {
  id: string;
  name: string;
  coverUrl: string;
  trackCount: number;
  owner: string;
}

interface SpotifyProfile {
  id: string;
  displayName: string;
  avatarUrl: string;
}

/**
 * One value rather than the old `connected` / `checkDone` / `loadingPlaylists`
 * trio, which had states that don't exist — "connected, done loading, zero
 * playlists" was reachable mid-fetch and rendered as "you have no playlists".
 */
type Connection =
  | { state: "loading" }
  | { state: "off" }
  | { state: "on"; profile: SpotifyProfile | null; playlists: SpotifyPlaylist[]; playlistsFailed: boolean }
  | { state: "failed" };

type Step = "sources" | "manual" | "preview";

/**
 * What the OAuth callback can hand back in `?spotify_error=`. Each says what
 * happened and what to do about it; none of them apologises or shows the raw
 * code, which is the only part the user can't act on.
 */
const OAUTH_ERRORS: Record<string, string> = {
  cancelled: "Spotify sign-in was cancelled.",
  access_denied: "Spotify sign-in was cancelled.",
  verifier_missing: "That sign-in took too long. Connect again to retry.",
  token_exchange_failed: "Spotify didn't complete the sign-in. Connect again to retry.",
  storage_failed: "The connection couldn't be saved. Connect again to retry.",
};

/**
 * Spotify's own mark. Deliberately inline rather than added to Icons.tsx: that
 * set is Sakura's icon language, and a third party's trademark isn't part of it —
 * it also must not be restyled the way our glyphs are.
 */
function SpotifyLogoIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      className={styles.spotifyLogo}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.516 17.312a.748.748 0 0 1-1.029.249c-2.817-1.721-6.362-2.11-10.535-1.157a.748.748 0 0 1-.356-1.452c4.566-1.043 8.483-.594 11.671 1.331a.748.748 0 0 1 .249 1.029zm1.47-3.27a.936.936 0 0 1-1.286.308c-3.225-1.982-8.14-2.556-11.957-1.399a.936.936 0 0 1-.55-1.79c4.358-1.342 9.775-.691 13.485 1.595a.936.936 0 0 1 .308 1.286zm.126-3.403c-3.867-2.297-10.244-2.509-13.932-1.388a1.123 1.123 0 1 1-.651-2.148c4.242-1.286 11.29-1.038 15.748 1.606a1.122 1.122 0 1 1-1.165 1.93z" />
    </svg>
  );
}

/** "1 hr 12 min" past the hour, "48 min" below it. Matches CollectionDetail. */
function formatRuntime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

function songCount(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? "song" : "songs"}`;
}

export function PlaylistModal({
  isOpen,
  onClose,
  onSuccess,
  startAt = "sources",
}: PlaylistModalProps) {
  const router = useRouter();
  const { showToast } = usePlayer();

  const [step, setStep] = useState<Step>(startAt);

  /*
   * One busy string instead of `isLoading` + `status`. The pair could disagree —
   * every call site had to write `isLoading && status` to avoid rendering a
   * spinner with no label — and a loading state with nothing to say is a loading
   * state that hasn't been designed.
   */
  const [busy, setBusy] = useState("");
  const isBusy = busy !== "";

  /*
   * Which source row is being read, so the row the user tapped is the thing that
   * shows it. A status line at the foot of a 40-playlist list is below the fold —
   * the tap would look like it did nothing.
   */
  const [pending, setPending] = useState<string | null>(null);

  // ── Sources ──────────────────────────────────────────────────────────────
  const [importUrl, setImportUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [conn, setConn] = useState<Connection>({ state: "loading" });
  /** Bumped to re-run the session fetch — the retry button and reconnects. */
  const [reloadKey, setReloadKey] = useState(0);
  /** Set when Liked Songs 403s because the connection predates that scope. */
  const [scopeNotice, setScopeNotice] = useState<string | null>(null);

  // ── Naming (manual form, and renaming an import) ─────────────────────────
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // ── Proof sheet ──────────────────────────────────────────────────────────
  const [tracks, setTracks] = useState<PreviewTrack[]>([]);
  /** Ids struck out of the import. Kept, not deleted — see the file header. */
  const [struck, setStruck] = useState<Set<string>>(() => new Set());
  /*
   * The source's own artwork, kept separately from the track covers.
   *
   * Conflating the two is what made every imported song show the playlist's
   * tile: the resolvers used to hand the playlist cover to each track as a
   * fallback, and the batch route wrote it into `Track.coverUrl`. Now the
   * playlist cover travels as itself.
   */
  const [sourceCoverUrl, setSourceCoverUrl] = useState("");
  /** e.g. "The 200 most recent of your 4,312 liked songs." */
  const [sourceNote, setSourceNote] = useState("");

  const kept = useMemo(() => tracks.filter((t) => !struck.has(t.id)), [tracks, struck]);
  const keptRuntime = useMemo(
    () => kept.reduce((sum, t) => sum + (t.duration || 0), 0),
    [kept]
  );

  // ── Reset when closed ────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) return;
    // After the exit animation, so the sheet doesn't visibly change content on
    // its way out.
    const t = setTimeout(() => {
      setStep(startAt);
      setBusy("");
      setPending(null);
      setImportUrl("");
      setLinkError(null);
      setConn({ state: "loading" });
      setScopeNotice(null);
      setName("");
      setDescription("");
      setTracks([]);
      setStruck(new Set());
      setSourceCoverUrl("");
      setSourceNote("");
    }, 300);
    return () => clearTimeout(t);
  }, [isOpen, startAt]);

  // ── Coming back from Spotify's consent screen ────────────────────────────
  /*
   * Read straight off `window.location` in an effect rather than through
   * `useSearchParams`. That hook makes the client tree up to the nearest
   * Suspense boundary client-rendered when the route is prerendered (Next 16
   * errors on it outside one), and this is a client-only question — "did this
   * page load come back from a redirect" — so it has no business changing how
   * the page renders. The params are then stripped with `history.replaceState`,
   * which Next's router observes, so a reload or a share doesn't replay the
   * toast.
   */
  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const connected = url.searchParams.get("spotify_connected");
    const failed = url.searchParams.get("spotify_error");

    if (connected) {
      showToast("Spotify connected", "success");
    } else if (failed) {
      showToast(OAUTH_ERRORS[failed] ?? "Spotify sign-in didn't finish.", "error");
    }

    if (connected || failed) {
      url.searchParams.delete("spotify_connected");
      url.searchParams.delete("spotify_error");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, [isOpen, showToast]);

  // ── The connected account, its playlists, and whether there is one ───────
  useEffect(() => {
    // Nothing to fetch when the sheet opened straight onto the naming form:
    // there is no route from there to the sources, so this would be a Spotify
    // round trip per "add to playlist → New Playlist" for a screen nobody sees.
    if (!isOpen || startAt === "manual") return;

    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/import/spotify/session", {
          signal: controller.signal,
        });
        const data = await res.json();

        if (!res.ok || !data.connected) {
          setConn({ state: "off" });
          return;
        }

        setConn({
          state: "on",
          profile: data.profile ?? null,
          playlists: data.playlists ?? [],
          playlistsFailed: Boolean(data.playlistsFailed),
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        /*
         * Distinct from "off". Telling someone to connect when the request
         * failed sends them round the OAuth loop to fix something that isn't
         * broken — and if they *are* connected, it also tells them a lie.
         */
        setConn({ state: "failed" });
      }
    })();

    return () => controller.abort();
  }, [isOpen, startAt, reloadKey]);

  const retryConnection = useCallback(() => {
    setConn({ state: "loading" });
    setScopeNotice(null);
    setReloadKey((k) => k + 1);
  }, []);

  /**
   * Both sources — a pasted link and something from the connected account —
   * arrive in this shape, so the proof sheet doesn't care which it was.
   */
  const goToPreview = useCallback(
    (data: {
      name?: string;
      coverUrl?: string;
      note?: string;
      tracks: { title: string; artist: string; duration?: number; coverUrl?: string }[];
    }) => {
      setTracks(
        data.tracks.map((t, i) => ({
          title: t.title,
          artist: t.artist,
          duration: t.duration ?? 0,
          coverUrl: t.coverUrl ?? "",
          // Identity for the list and for striking rows out. The source has no
          // stable id, and the index can't be one on its own because two rows
          // can be the same song twice.
          id: `${i}-${t.title}-${t.artist}`,
        }))
      );
      setStruck(new Set());
      setName(data.name || "Imported playlist");
      // The proof sheet has no description field, so an import always starts
      // without one — otherwise a description typed on the naming form and then
      // backed out of would ride along into an unrelated import.
      setDescription("");
      setSourceCoverUrl(data.coverUrl ?? "");
      setSourceNote(data.note ?? "");
      setStep("preview");
    },
    []
  );

  // ── Paste a link ─────────────────────────────────────────────────────────
  /*
   * Goes to `/api/import/link`, the provider-neutral resolver — not at Spotify
   * directly. That's what makes an album link, a single-track link, a Deezer
   * link and a share-sheet short link all work here, and what puts the keyless
   * engine in front of the Web API so a user who isn't on our Spotify app's
   * allowlist gets tracks instead of a 403. See lib/importLink.ts.
   */
  async function handleFetchLink() {
    if (!importUrl.trim()) return;
    setBusy("Reading the link…");
    setLinkError(null);
    try {
      const res = await fetch("/api/import/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That link couldn't be read.");
      if (!data.tracks?.length) throw new Error("That link has no songs in it.");
      goToPreview(data);
    } catch (err) {
      // Inline, next to the field it belongs to. A toast for a field-level
      // error disappears before the user has finished re-reading the URL.
      setLinkError(err instanceof Error ? err.message : "That link couldn't be read.");
    } finally {
      setBusy("");
    }
  }

  async function handlePasteUrl() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setImportUrl(text.trim());
        setLinkError(null);
      }
    } catch {
      // Clipboard API may be unavailable or denied — the field is still typable.
    }
  }

  // ── A playlist from the connected account ────────────────────────────────
  async function handleSelectPlaylist(playlist: SpotifyPlaylist) {
    setBusy(`Reading “${playlist.name}”…`);
    setPending(playlist.id);
    try {
      const res = await fetch("/api/import/spotify/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId: playlist.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That playlist couldn't be read.");
      if (!data.tracks?.length) throw new Error("That playlist is empty.");
      goToPreview({ ...data, name: data.name || playlist.name });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "That playlist couldn't be read.", "error");
    } finally {
      setBusy("");
      setPending(null);
    }
  }

  // ── Liked Songs ──────────────────────────────────────────────────────────
  /*
   * Fetched on tap rather than on open. It's up to 200 tracks and most sessions
   * won't ask for it, so paying for it to render one row would be a request per
   * modal open for nothing.
   */
  async function handleSelectLiked() {
    setBusy("Reading your Liked Songs…");
    setPending("liked");
    setScopeNotice(null);
    try {
      const res = await fetch("/api/import/spotify/liked");
      const data = await res.json();

      if (res.status === 403 && data.reconnect) {
        // A connection made before `user-library-read` was requested. Say what
        // fixes it rather than reporting Spotify's status code.
        setScopeNotice("Sakura needs permission to read your Liked Songs. Reconnect to grant it.");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Your Liked Songs couldn't be read.");
      if (!data.tracks?.length) throw new Error("You haven't liked any songs on Spotify yet.");

      goToPreview({
        name: "Liked Songs",
        tracks: data.tracks,
        note: data.truncated
          ? `The ${data.tracks.length} most recent of your ${data.total.toLocaleString()} liked songs.`
          : "",
      });
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Your Liked Songs couldn't be read.",
        "error"
      );
    } finally {
      setBusy("");
      setPending(null);
    }
  }

  async function handleDisconnect() {
    setBusy("Disconnecting…");
    try {
      const res = await fetch("/api/import/spotify/session", { method: "DELETE" });
      if (!res.ok) throw new Error();
      setConn({ state: "off" });
      setScopeNotice(null);
      showToast("Spotify disconnected", "success");
    } catch {
      showToast("Couldn't disconnect. Try again.", "error");
    } finally {
      setBusy("");
    }
  }

  // ── Proof sheet ──────────────────────────────────────────────────────────
  function toggleStruck(id: string) {
    setStruck((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirmImport() {
    if (kept.length === 0) return;
    setBusy("Creating the playlist…");
    try {
      const finalName = name.trim() || "Imported playlist";
      const createRes = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: finalName, description }),
      });
      if (!createRes.ok) throw new Error("The playlist couldn't be created.");
      const playlist = await createRes.json();

      setBusy(`Finding ${songCount(kept.length)} on Sakura…`);
      const batchRes = await fetch(`/api/playlists/${playlist.id}/tracks/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tracks: kept.map(({ title, artist, duration, coverUrl }) => ({
            title,
            artist,
            duration,
            coverUrl,
          })),
          coverUrl: sourceCoverUrl || undefined,
        }),
      });
      if (!batchRes.ok) throw new Error("The songs couldn't be saved.");

      showToast(`Imported ${songCount(kept.length)}`, "success");
      onSuccess?.(playlist.id);
      onClose();
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "The import didn't finish.", "error");
    } finally {
      setBusy("");
    }
  }

  // ── Create an empty playlist ─────────────────────────────────────────────
  async function handleCreateManual(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy("Creating…");
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description }),
      });
      if (!res.ok) throw new Error("The playlist couldn't be created.");
      const data = await res.json();
      showToast("Playlist created", "success");
      onSuccess?.(data.id);
      onClose();
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "The playlist couldn't be created.", "error");
    } finally {
      setBusy("");
    }
  }

  /**
   * Where "Connect Spotify" points, with instructions to come back to whatever
   * page this modal was opened from — the old flow always returned to /library,
   * so connecting from anywhere else silently moved the user.
   *
   * Computed during render rather than held in state. The return path depends on
   * `window.location`, and putting a client-only value in state means an effect
   * writing state on open, which commits a render with the wrong href in it. The
   * server branch never reaches the DOM: Sheet renders nothing without a
   * `document`, so this attribute only ever exists on the client.
   */
  const connectHref = `/api/auth/spotify?redirectBack=${encodeURIComponent(
    typeof window === "undefined"
      ? "/library"
      : window.location.pathname + window.location.search
  )}`;

  const title =
    step === "sources" ? "Bring music in" : step === "manual" ? "New playlist" : "Check the import";

  /*
   * Chosen once from `startAt`, not per step. A short naming form wants the
   * centred dialog and a list of playlists wants the bottom sheet, but swapping
   * variant while the panel is on screen re-runs a transform transition from a
   * different start position — the panel jumps.
   */
  const variant = startAt === "manual" ? "dialog" : "sheet";

  return (
    <Sheet
      open={isOpen}
      onClose={onClose}
      title={title}
      variant={variant}
      dismissible={!isBusy}
      footer={
        step === "sources" ? (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnQuiet} pressable`}
            onClick={() => {
              setName("");
              setStep("manual");
            }}
            disabled={isBusy}
          >
            <PlusIcon size={16} />
            Start an empty playlist
          </button>
        ) : step === "manual" ? (
          <>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnCancel} pressable`}
              onClick={() => (startAt === "manual" ? onClose() : setStep("sources"))}
              disabled={isBusy}
            >
              {startAt === "manual" ? "Cancel" : "Back"}
            </button>
            <button
              type="submit"
              form="new-playlist-form"
              className={`${styles.btn} ${styles.btnSubmit} pressable`}
              disabled={isBusy || !name.trim()}
            >
              {isBusy ? <span className={`${styles.spinner} ${styles.spinnerSmall}`} /> : null}
              Create playlist
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnCancel} pressable`}
              onClick={() => setStep("sources")}
              disabled={isBusy}
            >
              Back
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSubmit} pressable`}
              onClick={handleConfirmImport}
              disabled={isBusy || kept.length === 0}
            >
              {isBusy ? <span className={`${styles.spinner} ${styles.spinnerSmall}`} /> : null}
              {kept.length === 0 ? "Nothing to import" : `Import ${songCount(kept.length)}`}
            </button>
          </>
        )
      }
    >
      {/* ── Sources ──────────────────────────────────────────────────────── */}
      {step === "sources" && (
        <div className={styles.sources}>
          <section className={styles.group}>
            <h3 className={styles.eyebrow}>Paste a link</h3>
            <div className={styles.linkRow}>
              <input
                className={styles.input}
                placeholder="Spotify or Deezer link"
                aria-label="Link to import"
                aria-invalid={linkError ? true : undefined}
                inputMode="url"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={importUrl}
                onChange={(e) => {
                  setImportUrl(e.target.value);
                  if (linkError) setLinkError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && importUrl.trim() && !isBusy) {
                    e.preventDefault();
                    void handleFetchLink();
                  }
                }}
                disabled={isBusy}
              />
              <button
                type="button"
                className={styles.pasteBtn}
                onClick={handlePasteUrl}
                disabled={isBusy}
              >
                Paste
              </button>
            </div>

            {linkError ? (
              <p className={styles.fieldError} role="alert">
                {linkError}
              </p>
            ) : (
              <p className={styles.fieldHint}>
                A playlist, an album or one song. The short links the mobile apps
                share work too.
              </p>
            )}

            {/*
              The action appears with the link. A permanently disabled accent
              button is the loudest thing on a screen whose job is to show you
              your own music — it would compete with the playlist rows for
              nothing, since there is nothing to find until something is pasted.
            */}
            {importUrl.trim() && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSubmit} pressable`}
                onClick={handleFetchLink}
                disabled={isBusy}
              >
                {isBusy ? <span className={`${styles.spinner} ${styles.spinnerSmall}`} /> : null}
                Find these songs
              </button>
            )}
          </section>

          <hr className={styles.rule} />

          <section className={styles.group}>
            <h3 className={styles.eyebrow}>From Spotify</h3>

            {conn.state === "loading" && (
              <div className={styles.accountSkeleton} aria-hidden="true">
                <span className={`${styles.accountAvatar} skeleton`} />
                <span className={styles.accountSkeletonLines}>
                  <span className={`${styles.skelLine} skeleton`} />
                  <span className={`${styles.skelLineShort} skeleton`} />
                </span>
              </div>
            )}

            {conn.state === "failed" && (
              <div className={styles.notice}>
                <p>Your Spotify details didn&rsquo;t load.</p>
                <button type="button" className={styles.retryBtn} onClick={retryConnection}>
                  Try again
                </button>
              </div>
            )}

            {conn.state === "off" && (
              <div className={styles.connectBlock}>
                <p className={styles.connectCopy}>
                  Connect your account to import your own playlists and Liked
                  Songs, including private ones.
                </p>
                <a href={connectHref} className={`${styles.connectBtn} pressable`}>
                  <SpotifyLogoIcon size={20} />
                  Connect Spotify
                </a>
              </div>
            )}

            {conn.state === "on" && (
              <>
                <div className={styles.account}>
                  {conn.profile?.avatarUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={conn.profile.avatarUrl}
                      alt=""
                      className={styles.accountAvatar}
                    />
                  ) : (
                    <span className={styles.accountAvatarFallback} aria-hidden="true">
                      <SpotifyLogoIcon size={18} />
                    </span>
                  )}
                  <span className={styles.accountText}>
                    <span className={styles.accountName}>
                      {conn.profile?.displayName || "Your Spotify"}
                    </span>
                    <span className={styles.accountMeta}>
                      {conn.playlists.length > 0
                        ? `${conn.playlists.length} ${
                            conn.playlists.length === 1 ? "playlist" : "playlists"
                          }`
                        : "Connected"}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={styles.disconnectBtn}
                    onClick={handleDisconnect}
                    disabled={isBusy}
                  >
                    Disconnect
                  </button>
                </div>

                {scopeNotice && (
                  <div className={styles.notice} role="alert">
                    <p>{scopeNotice}</p>
                    <a href={connectHref} className={styles.retryBtn}>
                      Reconnect Spotify
                    </a>
                  </div>
                )}

                <div className={`${styles.sourceList} anim-stagger`}>
                  {/*
                   * Liked Songs first, and the only row with an accent-tinted
                   * mark instead of artwork. It has no cover and no shareable
                   * URL — connecting an account is the only way to reach it, so
                   * it is the strongest reason this section exists.
                   */}
                  <button
                    type="button"
                    className={`${styles.sourceRow} pressable`}
                    onClick={handleSelectLiked}
                    disabled={isBusy}
                    style={{ "--i": 0 } as React.CSSProperties}
                  >
                    <span className={`${styles.sourceArt} ${styles.sourceArtLiked}`}>
                      <HeartIcon size={18} filled />
                    </span>
                    <span className={styles.sourceText}>
                      <span className={styles.sourceName}>Liked Songs</span>
                      <span className={styles.sourceMeta}>Your saved songs, newest first</span>
                    </span>
                    {pending === "liked" ? (
                      <span className={styles.rowSpinner} />
                    ) : (
                      <ChevronRightIcon size={16} className={styles.sourceChevron} />
                    )}
                  </button>

                  {conn.playlists.map((pl, i) => (
                    <button
                      key={pl.id}
                      type="button"
                      className={`${styles.sourceRow} pressable`}
                      onClick={() => handleSelectPlaylist(pl)}
                      disabled={isBusy}
                      style={{ "--i": Math.min(i + 1, 12) } as React.CSSProperties}
                    >
                      {pl.coverUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={pl.coverUrl} alt="" loading="lazy" className={styles.sourceArt} />
                      ) : (
                        <span className={styles.sourceArt}>
                          <PlaylistIcon size={18} />
                        </span>
                      )}
                      <span className={styles.sourceText}>
                        <span className={styles.sourceName}>{pl.name}</span>
                        <span className={styles.sourceMeta}>
                          {songCount(pl.trackCount)}
                          {/* Only when it isn't you. Every row stamped with the
                              connected account's own name is noise; a row stamped
                              with someone else's is the fact that it's a playlist
                              you follow rather than one you made. */}
                          {pl.owner && pl.owner !== conn.profile?.displayName
                            ? ` · ${pl.owner}`
                            : ""}
                        </span>
                      </span>
                      {pending === pl.id ? (
                        <span className={styles.rowSpinner} />
                      ) : (
                        <ChevronRightIcon size={16} className={styles.sourceChevron} />
                      )}
                    </button>
                  ))}
                </div>

                {/*
                 * `playlistsFailed` used to be returned by the endpoint and read
                 * by nobody, so a failed playlist fetch looked exactly like an
                 * account with no playlists.
                 */}
                {conn.playlistsFailed ? (
                  <div className={styles.notice}>
                    <p>Your playlists didn&rsquo;t load.</p>
                    <button type="button" className={styles.retryBtn} onClick={retryConnection}>
                      Try again
                    </button>
                  </div>
                ) : conn.playlists.length === 0 ? (
                  <p className={styles.fieldHint}>
                    This account has no playlists yet — Liked Songs and pasted
                    links still work.
                  </p>
                ) : null}
              </>
            )}
          </section>

          {/*
            Announced, not shown. The visible signal on this screen is the spinner
            on the row being read; this is the same information for a screen reader.
            It stays in the tree even when empty — a live region that is display:none
            until it has something to say is not in the accessibility tree at the
            moment it changes, and so announces nothing.
          */}
          <p className="srOnly" aria-live="polite">
            {busy}
          </p>
        </div>
      )}

      {/* ── New playlist ─────────────────────────────────────────────────── */}
      {step === "manual" && (
        <form id="new-playlist-form" onSubmit={handleCreateManual} className={styles.formStack}>
          <div className={styles.inputGroup}>
            <label htmlFor="playlist-name" className={styles.label}>
              Name
            </label>
            <input
              id="playlist-name"
              className={styles.input}
              placeholder="Late night drives"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isBusy}
              autoFocus
            />
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="playlist-desc" className={styles.label}>
              Description <span className={styles.labelOptional}>optional</span>
            </label>
            <textarea
              id="playlist-desc"
              className={`${styles.input} ${styles.textarea}`}
              placeholder="What this one is for"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isBusy}
            />
          </div>
        </form>
      )}

      {/* ── Proof sheet ──────────────────────────────────────────────────── */}
      {step === "preview" && (
        <div className={styles.proof}>
          <div className={styles.proofHead}>
            {sourceCoverUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={sourceCoverUrl} alt="" className={styles.proofArt} />
            ) : (
              <span className={`${styles.proofArt} ${styles.proofArtFallback}`} aria-hidden="true">
                <PlaylistIcon size={22} />
              </span>
            )}
            <div className={styles.proofHeadText}>
              {/*
               * Editable here, which it never was. The old confirm step read a
               * `name` that only the manual form could set, so an import always
               * took the source's own title with no way to change it.
               */}
              <label htmlFor="import-name" className="srOnly">
                Playlist name
              </label>
              <input
                id="import-name"
                className={styles.proofName}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isBusy}
                placeholder="Name this playlist"
              />
              <p className={styles.proofMeta}>
                {songCount(kept.length)}
                {keptRuntime > 0 ? ` · ${formatRuntime(keptRuntime)}` : ""}
                {struck.size > 0 ? ` · ${struck.size} removed` : ""}
              </p>
            </div>
          </div>

          {sourceNote && <p className={styles.fieldHint}>{sourceNote}</p>}

          <ul className={styles.proofList}>
            {tracks.map((track) => {
              const out = struck.has(track.id);
              return (
                <li
                  key={track.id}
                  className={styles.proofRow}
                  data-struck={out ? "true" : undefined}
                >
                  {track.coverUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={track.coverUrl}
                      alt=""
                      loading="lazy"
                      className={styles.proofRowArt}
                    />
                  ) : (
                    <span className={styles.proofRowArt} aria-hidden="true" />
                  )}
                  <span className={styles.proofRowText}>
                    <span className={styles.proofRowTitle}>{track.title}</span>
                    <span className={styles.proofRowArtist}>{track.artist}</span>
                  </span>
                  {track.duration > 0 && (
                    <span className={styles.proofRowTime}>
                      {Math.floor(track.duration / 60)}:
                      {String(track.duration % 60).padStart(2, "0")}
                    </span>
                  )}
                  <button
                    type="button"
                    className={styles.strikeBtn}
                    onClick={() => toggleStruck(track.id)}
                    disabled={isBusy}
                    aria-label={
                      out
                        ? `Put ${track.title} back in the import`
                        : `Leave ${track.title} out of the import`
                    }
                  >
                    {out ? <PlusIcon size={16} /> : <CloseIcon size={16} />}
                  </button>
                </li>
              );
            })}
          </ul>

          <p className={styles.busyLine} aria-live="polite">
            {busy}
          </p>
        </div>
      )}
    </Sheet>
  );
}
