"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import styles from "./PlaylistModal.module.css";
import { usePlayer } from "./PlayerContext";
import { Sheet } from "./Sheet";
import { PlaylistIcon } from "./Icons";

interface PlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (playlistId: string) => void;
}

interface PreviewTrack {
  title: string;
  artist: string;
  duration: number;
  coverUrl: string;
  id: string;
}

interface SpotifyPlaylist {
  id: string;
  name: string;
  coverUrl: string;
  trackCount: number;
  owner: string;
}

type Step = "pick" | "manual" | "spotify" | "preview";

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

export function PlaylistModal({ isOpen, onClose, onSuccess }: PlaylistModalProps) {
  const router = useRouter();
  const { showToast } = usePlayer();

  // ── Form state ───────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("pick");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("");
  /** Field-level failure for the pasted link, shown under the field. */
  const [linkError, setLinkError] = useState<string | null>(null);

  // ── Preview state ────────────────────────────────────────────────────────
  const [previewTracks, setPreviewTracks] = useState<PreviewTrack[]>([]);
  const [playlistName, setPlaylistName] = useState("");
  /*
   * The source's own playlist artwork, kept separately from the track covers.
   *
   * Conflating the two is what made every imported song show the playlist's
   * tile: the resolvers used to hand the playlist cover to each track as a
   * fallback, and the batch route wrote it into `Track.coverUrl`. Now the
   * playlist cover travels as itself and the batch route uses it for the
   * playlist only — falling back to a collage of real track covers when the
   * source didn't have one.
   */
  const [sourceCoverUrl, setSourceCoverUrl] = useState<string>("");
  const [removedTrack, setRemovedTrack] = useState<{ track: PreviewTrack; index: number } | null>(null);
  const undoTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ── Spotify OAuth state ──────────────────────────────────────────────────
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [spotifyCheckDone, setSpotifyCheckDone] = useState(false);
  const [userPlaylists, setUserPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);

  // ── Reset when closed ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => {
        setStep("pick");
        setPreviewTracks([]);
        setSourceCoverUrl("");
        setRemovedTrack(null);
        setName("");
        setDescription("");
        setImportUrl("");
        setStatus("");
        setLinkError(null);
        setUserPlaylists([]);
        setSpotifyCheckDone(false);
      }, 300);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // ── Your connected Spotify account ──────────────────────────────────────
  const loadUserPlaylists = useCallback(async () => {
    setLoadingPlaylists(true);
    try {
      const res = await fetch("/api/import/spotify/playlists");
      const data = await res.json();
      if (res.ok) {
        setUserPlaylists(data.playlists ?? []);
      } else if (data.error === "spotify_not_connected") {
        setSpotifyConnected(false);
      }
    } catch {
      // silent — user can retry
    } finally {
      setLoadingPlaylists(false);
    }
  }, []);

  /*
   * Declared *after* the loader it calls, previously — so the effect closed over
   * a binding that didn't exist yet and could never see a later definition. It
   * happened to work because `useCallback` returns a stable function and the
   * effect ran after commit, but the dependency was missing and the ordering was
   * a genuine hazard. Loader first, and listed as a dependency.
   */
  useEffect(() => {
    if (step !== "spotify" || spotifyCheckDone) return;

    fetch("/api/import/spotify/check")
      .then((r) => r.json())
      .then((data) => {
        setSpotifyConnected(data.connected ?? false);
        setSpotifyCheckDone(true);
        if (data.connected) void loadUserPlaylists();
      })
      .catch(() => setSpotifyCheckDone(true));
  }, [step, spotifyCheckDone, loadUserPlaylists]);

  // ── Fetch preview from a pasted link ────────────────────────────────────
  /*
   * Goes to `/api/import/link`, the provider-neutral resolver — not at Spotify
   * directly. That's what makes an album link, a single-track link, a Deezer
   * link and a share-sheet short link all work here, and what puts the keyless
   * engine in front of the Web API so a user who isn't on our Spotify app's
   * allowlist gets tracks instead of a 403. See lib/importLink.ts.
   */
  async function handleFetchPublicUrl() {
    if (!importUrl.trim()) return;
    setIsLoading(true);
    setLinkError(null);
    setStatus("Reading the link…");
    try {
      const res = await fetch("/api/import/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't read that link.");
      if (!data.tracks?.length) throw new Error("That link didn't have any tracks in it.");
      goToPreview(data);
    } catch (err) {
      // Inline, next to the field it belongs to. A toast for a field-level
      // error disappears before the user has finished reading the URL again.
      setLinkError(err instanceof Error ? err.message : "Couldn't read that link.");
    } finally {
      setIsLoading(false);
      setStatus("");
    }
  }

  // ── Select a playlist from user's Spotify account ───────────────────────
  async function handleSelectUserPlaylist(playlist: SpotifyPlaylist) {
    setIsLoading(true);
    setStatus(`Loading "${playlist.name}"…`);
    try {
      const res = await fetch("/api/import/spotify/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId: playlist.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch playlist tracks");
      goToPreview(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't load that playlist.", "error");
    } finally {
      setIsLoading(false);
      setStatus("");
    }
  }

  /**
   * Both sources — a pasted link and a playlist picked from the connected
   * account — arrive in this shape, so the preview doesn't care which it was.
   */
  function goToPreview(data: {
    name?: string;
    coverUrl?: string;
    tracks: { title: string; artist: string; duration?: number; coverUrl?: string }[];
  }) {
    const tracksWithIds: PreviewTrack[] = data.tracks.map((t) => ({
      title: t.title,
      artist: t.artist,
      duration: t.duration ?? 0,
      coverUrl: t.coverUrl ?? "",
      // Identity for the list and for undo — the source has no stable id, and
      // the index can't be one because rows are removable.
      id: `${t.title}-${t.artist}-${Math.random().toString(36).slice(2, 8)}`,
    }));
    setPreviewTracks(tracksWithIds);
    setPlaylistName(data.name || "Imported Playlist");
    setSourceCoverUrl(data.coverUrl ?? "");
    setStep("preview");
  }

  // ── Remove/undo in preview ───────────────────────────────────────────────
  function handleRemoveTrack(index: number) {
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    const track = previewTracks[index];
    setRemovedTrack({ track, index });
    setPreviewTracks((prev) => {
      const copy = [...prev];
      copy.splice(index, 1);
      return copy;
    });
    undoTimeoutRef.current = setTimeout(() => setRemovedTrack(null), 5000);
  }

  function handleUndoRemove() {
    if (removedTrack) {
      setPreviewTracks((prev) => {
        const copy = [...prev];
        copy.splice(removedTrack.index, 0, removedTrack.track);
        return copy;
      });
      setRemovedTrack(null);
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    }
  }

  // ── Confirm import ───────────────────────────────────────────────────────
  async function handleConfirmImport() {
    setIsLoading(true);
    setStatus("Creating playlist…");
    try {
      const finalName = name.trim() || playlistName || "Imported Playlist";
      const createRes = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: finalName, description }),
      });
      if (!createRes.ok) throw new Error("Failed to create playlist");
      const playlist = await createRes.json();

      setStatus("Saving tracks…");
      const batchRes = await fetch(`/api/playlists/${playlist.id}/tracks/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks: previewTracks, coverUrl: sourceCoverUrl || undefined }),
      });
      if (!batchRes.ok) throw new Error("Failed to save tracks");

      showToast(`Imported ${previewTracks.length} tracks!`, "success");
      if (onSuccess) onSuccess(playlist.id);
      onClose();
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't import those tracks.", "error");
    } finally {
      setIsLoading(false);
      setStatus("");
    }
  }

  // ── Create manually ──────────────────────────────────────────────────────
  async function handleCreateManual(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) throw new Error("Failed to create playlist");
      const data = await res.json();
      showToast("Playlist created!", "success");
      if (onSuccess) onSuccess(data.id);
      onClose();
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Something went wrong", "error");
    } finally {
      setIsLoading(false);
    }
  }

  // ── Paste from clipboard ─────────────────────────────────────────────────
  async function handlePasteUrl() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setImportUrl(text.trim());
    } catch {
      // Clipboard API may be unavailable — user can type
    }
  }

  // ── Title for each step ──────────────────────────────────────────────────
  const sheetTitle =
    step === "pick"
      ? "New Playlist"
      : step === "manual"
      ? "Create Playlist"
      : step === "spotify"
      ? "Import music"
      : "Preview Playlist";

  return (
    <Sheet
      open={isOpen}
      onClose={onClose}
      title={sheetTitle}
      variant="dialog"
      dismissible={!isLoading}
    >
      {/* ── Step: pick ──────────────────────────────────────────────────── */}
      {step === "pick" && (
        <div className={styles.pickStep}>
          <p className={styles.pickSubtitle}>
            Start fresh, or bring tracks in from a link you paste
          </p>
          <div className={styles.optionCards}>
            <button
              type="button"
              className={styles.optionCard}
              onClick={() => setStep("manual")}
            >
              <span className={`${styles.optionCardIcon} ${styles.optionCardIconManual}`}>
                <PlaylistIcon size={24} />
              </span>
              <span className={styles.optionCardLabel}>Create manually</span>
              <span className={styles.optionCardDesc}>Name it and add songs as you go</span>
            </button>

            <button
              type="button"
              className={styles.optionCard}
              onClick={() => setStep("spotify")}
            >
              <span className={`${styles.optionCardIcon} ${styles.optionCardIconSpotify}`}>
                <SpotifyLogoIcon size={24} />
              </span>
              <span className={styles.optionCardLabel}>Import from a link</span>
              <span className={styles.optionCardDesc}>
                Spotify or Deezer — or pick from your Spotify account
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ── Step: manual ────────────────────────────────────────────────── */}
      {step === "manual" && (
        <form onSubmit={handleCreateManual} className={styles.formStack}>
          <div className={styles.inputGroup}>
            <label htmlFor="playlist-name" className={styles.label}>Name</label>
            <input
              id="playlist-name"
              className={styles.input}
              placeholder="My Awesome Playlist"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isLoading}
              autoFocus
            />
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="playlist-desc" className={styles.label}>
              Description <span style={{ color: "var(--text-3)", fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              id="playlist-desc"
              className={`${styles.input} ${styles.textarea}`}
              placeholder="A brief description…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnCancel} pressable`}
              onClick={() => setStep("pick")}
              disabled={isLoading}
            >
              Back
            </button>
            <button
              type="submit"
              className={`${styles.btn} ${styles.btnSubmit} pressable`}
              disabled={isLoading || !name.trim()}
            >
              {isLoading ? <span className={`${styles.spinner} ${styles.spinnerSmall}`} /> : null}
              Create
            </button>
          </div>
        </form>
      )}

      {/* ── Step: spotify ───────────────────────────────────────────────── */}
      {step === "spotify" && (
        <div className={styles.spotifyStep}>
          {/* ── Paste a link ── */}
          <div className={styles.spotifySection}>
            <span className={styles.sectionHeading}>Paste a link</span>
            <div className={styles.urlInputRow}>
              <input
                className={styles.input}
                placeholder="Song, album or playlist link"
                aria-label="Link to import"
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
                  if (e.key === "Enter" && importUrl.trim() && !isLoading) {
                    e.preventDefault();
                    void handleFetchPublicUrl();
                  }
                }}
                disabled={isLoading}
                autoFocus
              />
              <button
                type="button"
                className={styles.pasteBtn}
                onClick={handlePasteUrl}
                disabled={isLoading}
                title="Paste from clipboard"
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
                Spotify or Deezer — including the short links the mobile apps share.
              </p>
            )}

            <button
              type="button"
              className={`${styles.btn} ${styles.btnSubmit} pressable`}
              onClick={handleFetchPublicUrl}
              disabled={isLoading || !importUrl.trim()}
              style={{ marginTop: 0 }}
            >
              {isLoading && status ? (
                <><span className={`${styles.spinner} ${styles.spinnerSmall}`} /> {status}</>
              ) : "Find the tracks"}
            </button>
          </div>

          <div className={styles.divider}>or</div>

          {/* ── Your Spotify account ── */}
          <div className={styles.spotifySection}>
            <span className={styles.sectionHeading}>Your Spotify playlists</span>

            {!spotifyCheckDone ? (
              <div className={styles.progressContainer}>
                <div className={styles.spinner} />
              </div>
            ) : spotifyConnected ? (
              <>
                <div className={styles.connectedBadge}>
                  <span className={styles.connectedDot} />
                  Connected to Spotify
                </div>
                {loadingPlaylists ? (
                  <div className={styles.progressContainer}>
                    <div className={styles.spinner} />
                    <div className={styles.progressText}>Loading your playlists…</div>
                  </div>
                ) : userPlaylists.length === 0 ? (
                  <div className={styles.progressText}>No playlists found in your account.</div>
                ) : (
                  <div className={styles.userPlaylistList}>
                    {userPlaylists.map((pl) => (
                      <button
                        key={pl.id}
                        type="button"
                        className={styles.userPlaylistRow}
                        onClick={() => handleSelectUserPlaylist(pl)}
                        disabled={isLoading}
                      >
                        {pl.coverUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={pl.coverUrl} alt="" className={styles.userPlaylistCover} />
                        ) : (
                          <span className={styles.userPlaylistCoverPlaceholder}>
                            <PlaylistIcon size={18} />
                          </span>
                        )}
                        <span className={styles.userPlaylistInfo}>
                          <span className={styles.userPlaylistName}>{pl.name}</span>
                          <span className={styles.userPlaylistMeta}>
                            {pl.trackCount} tracks{pl.owner ? ` · ${pl.owner}` : ""}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <a
                href={`/api/auth/spotify?redirectBack=${encodeURIComponent("/library")}`}
                className={styles.connectSpotifyBtn}
              >
                <SpotifyLogoIcon size={20} />
                Connect Spotify account
              </a>
            )}
          </div>

          <div className={styles.actions} style={{ marginTop: "var(--space-2)" }}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnCancel} pressable`}
              onClick={() => setStep("pick")}
              disabled={isLoading}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {/* ── Step: preview ───────────────────────────────────────────────── */}
      {step === "preview" && (
        <div className={styles.previewContainer}>
          <div className={styles.previewHeader}>
            <h3 className={styles.previewTitle}>{playlistName}</h3>
            <span className={styles.previewCount}>{previewTracks.length} tracks</span>
          </div>

          <div className={styles.trackList}>
            {previewTracks.map((track, i) => (
              <div key={track.id} className={styles.trackRow}>
                {track.coverUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={track.coverUrl} className={styles.trackCover} alt="" />
                ) : (
                  <div className={styles.trackCoverPlaceholder} />
                )}
                <div className={styles.trackInfo}>
                  <div className={styles.trackTitle}>{track.title}</div>
                  <div className={styles.trackArtist}>{track.artist}</div>
                </div>
                <button
                  className={styles.removeBtn}
                  onClick={() => handleRemoveTrack(i)}
                  title="Remove track"
                  disabled={isLoading}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {removedTrack && (
            <div className={styles.undoToast}>
              <span>Removed &ldquo;{removedTrack.track.title}&rdquo;</span>
              <button onClick={handleUndoRemove} className={styles.undoBtn}>Undo</button>
            </div>
          )}

          {isLoading && status && (
            <div className={styles.progressContainer}>
              <div className={styles.spinner} />
              <div className={styles.progressText}>{status}</div>
            </div>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnCancel} pressable`}
              onClick={() => setStep("spotify")}
              disabled={isLoading}
            >
              Back
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSubmit} pressable`}
              onClick={handleConfirmImport}
              disabled={isLoading || previewTracks.length === 0}
            >
              {isLoading ? (
                <><span className={`${styles.spinner} ${styles.spinnerSmall}`} /> {status || "Saving…"}</>
              ) : `Import ${previewTracks.length} tracks`}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
