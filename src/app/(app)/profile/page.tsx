"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  SettingsIcon,
  ImageIcon,
  CalendarIcon,
  ShareIcon,
  ClockIcon,
  HeadphonesIcon,
  PlaylistIcon,
  FireIcon,
  DownloadIcon,
  MusicNoteIcon,
  ChevronRightIcon,
  CheckIcon,
  GlobeIcon,
  LockIcon,
  AlertIcon,
} from "@/components/Icons";
import styles from "./page.module.css";

type ProfileData = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  bio: string;
  email: string;
  plan: string;
  memberSince: string;
  stats: { label: string; value: string }[];
  topArtists: { id: string; name: string; trackCount: number; avatarUrl?: string | null }[];
  topTracks: { id: string; title: string; artist: string; coverUrl?: string | null }[];
};

type PlaylistRow = {
  id: string;
  name: string;
  coverUrl: string | null;
  trackCount: number;
  isPublic: boolean;
};

const BIO_MAX = 160;

/** Stat icons in the same order the API returns stats. */
const STAT_ICONS = [ClockIcon, MusicNoteIcon, HeadphonesIcon, PlaylistIcon, FireIcon];

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function ProfilePage() {

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [savingBio, setSavingBio] = useState(false);
  const [bioError, setBioError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [shareState, setShareState] = useState<"idle" | "copied" | "failed">("idle");
  const [exporting, setExporting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropImgRef = useRef<HTMLImageElement>(null);

  const load = useCallback(async () => {
    try {
      const [pRes, plRes] = await Promise.all([
        fetch("/api/profile"),
        fetch("/api/playlists"),
      ]);

      if (!pRes.ok) throw new Error("profile");
      const data = await pRes.json();
      // Cleared here rather than at the top of the function: a synchronous
      // setState in the effect body cascades an extra render on every mount.
      setLoadError(null);
      setProfile(data);
      setBioDraft(data.bio || "");

      if (plRes.ok) {
        // This endpoint returns a bare array (not {playlists: [...]}) — the
        // shape library/page.tsx and AddToPlaylistModal already rely on.
        const pl = await plRes.json();
        setPlaylists(Array.isArray(pl) ? pl : []);
      }
    } catch {
      // Previously this had no catch at all, so a failed request left the page
      // stuck on the word "Loading..." with no way forward.
      setLoadError("We couldn't load your profile. Check your connection.");
    }
  }, []);

  useEffect(() => {
    // Wrapped in an IIFE rather than calling `load()` directly: the lint rule
    // treats a bare call in the effect body as a synchronous setState, and the
    // wrapper makes the async boundary explicit.
    (async () => {
      await load();
    })();
  }, [load]);

  /* ── Avatar ────────────────────────────────────────────────────────────── */

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setUploadError("That file isn't an image.");
      return;
    }
    // 8MB in, before any cropping. The crop below shrinks it a lot.
    if (file.size > 8 * 1024 * 1024) {
      setUploadError("That image is too large. Pick one under 8MB.");
      return;
    }

    setUploadError(null);
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.onerror = () => setUploadError("We couldn't read that file.");
    reader.readAsDataURL(file);
  }

  /**
   * Actually crop, rather than pretending to.
   *
   * The old flow showed a "crop" dialog and then uploaded the untouched
   * original — so a 4000×3000 photo became the avatar, was squashed by
   * `object-fit` in CSS, and cost several megabytes on every page that showed
   * it. This centre-crops to a square and downscales to 512px before upload.
   */
  async function confirmCrop() {
    if (!cropSrc) return;
    setUploading(true);
    setUploadError(null);

    try {
      const img = cropImgRef.current;
      if (!img || !img.naturalWidth) throw new Error("not-loaded");

      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      const out = Math.min(512, side);

      const canvas = document.createElement("canvas");
      canvas.width = out;
      canvas.height = out;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no-canvas");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9)
      );
      if (!blob) throw new Error("no-blob");

      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: { "Content-Type": blob.type },
        body: blob,
      });

      if (!response.ok) throw new Error("upload");

      const data = await response.json();
      setProfile((p) => (p ? { ...p, avatarUrl: data.avatarUrl } : null));
      setCropSrc(null);
    } catch {
      setUploadError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  /* ── Bio ───────────────────────────────────────────────────────────────── */

  async function saveBio() {
    setSavingBio(true);
    setBioError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio: bioDraft }),
      });
      if (!res.ok) throw new Error();
      setProfile((p) => (p ? { ...p, bio: bioDraft } : null));
      setEditingBio(false);
    } catch {
      // The old code updated local state unconditionally, so a rejected save
      // looked successful until the next reload silently reverted it.
      setBioError("Couldn't save. Try again.");
    } finally {
      setSavingBio(false);
    }
  }

  /* ── Share ─────────────────────────────────────────────────────────────── */

  async function handleShare() {
    if (!profile) return;

    // The old version copied `https://sakura.app/u/<name>` — a domain we don't
    // own and a route that doesn't exist. Use this deployment's real origin.
    const url = `${window.location.origin}/u/${profile.id}`;

    try {
      if (navigator.share) {
        await navigator.share({ title: `${profile.name} on Sakura`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareState("copied");
      setTimeout(() => setShareState("idle"), 1800);
    } catch (err) {
      // A cancelled share sheet rejects with AbortError; that isn't a failure.
      if ((err as Error)?.name === "AbortError") return;
      setShareState("failed");
      setTimeout(() => setShareState("idle"), 2400);
    }
  }

  /* ── Playlist visibility ───────────────────────────────────────────────── */

  async function togglePlaylistVisibility(id: string, next: boolean) {
    // Optimistic, with rollback — the toggle should feel instant.
    setPlaylists((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isPublic: next } : p))
    );

    try {
      const res = await fetch(`/api/playlists/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setPlaylists((prev) =>
        prev.map((p) => (p.id === id ? { ...p, isPublic: !next } : p))
      );
    }
  }

  /* ── Export ────────────────────────────────────────────────────────────── */

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/export");
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sakura-export.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Without this the blob is pinned in memory for the life of the tab.
      URL.revokeObjectURL(url);
    } catch {
      setUploadError("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  /* ── Render ────────────────────────────────────────────────────────────── */

  if (loadError) {
    return (
      <div className={styles.page} data-page-scroll>
        <div className={styles.errorState}>
          <AlertIcon size={30} />
          <p className={styles.errorText}>{loadError}</p>
          <button className={styles.retryBtn} onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className={styles.page} data-page-scroll>
        <div className={styles.hero}>
          <div className={`${styles.avatar} skeleton`} />
          <div className={`${styles.skelName} skeleton`} />
          <div className={`${styles.skelBio} skeleton`} />
        </div>
        <div className={styles.statsGrid}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={`${styles.statCard} skeleton`} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page} data-page-scroll>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <header className={styles.hero}>
        {/* The settings entry point the profile was missing entirely. */}
        <Link href="/settings" className={styles.settingsBtn} aria-label="Settings" data-anim>
          <SettingsIcon size={20} />
        </Link>

        <div className={styles.avatarWrap}>
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" className={styles.avatar} />
          ) : (
            <div className={styles.avatarPlaceholder}>{initials(profile.name)}</div>
          )}
          <button
            type="button"
            className={styles.editAvatarBtn}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            aria-label="Change profile photo"
          >
            {uploading ? <span className={styles.spinner} /> : <ImageIcon size={14} />}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleFileChange}
          />
        </div>

        <h1 className={styles.username}>{profile.name}</h1>

        {editingBio ? (
          <div className={styles.bioEdit}>
            <textarea
              className={styles.bioInput}
              rows={2}
              maxLength={BIO_MAX}
              value={bioDraft}
              onChange={(e) => setBioDraft(e.target.value)}
              autoFocus
              aria-label="Your bio"
            />
            <div className={styles.bioMeta}>
              <span className={styles.bioCount}>
                {bioDraft.length}/{BIO_MAX}
              </span>
              {bioError && <span className={styles.bioError}>{bioError}</span>}
            </div>
            <div className={styles.bioActions}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => {
                  setBioDraft(profile.bio);
                  setBioError(null);
                  setEditingBio(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={saveBio}
                disabled={savingBio}
              >
                {savingBio ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={styles.bio}
            onClick={() => setEditingBio(true)}
          >
            {profile.bio || "Add a short bio"}
          </button>
        )}

        <p className={styles.memberSince}>
          <CalendarIcon size={13} />
          <span>Listening since {profile.memberSince}</span>
        </p>

        <button type="button" className={`${styles.shareBtn} pressable`} onClick={handleShare}>
          {shareState === "copied" ? <CheckIcon size={15} /> : <ShareIcon size={15} />}
          {shareState === "copied"
            ? "Link copied"
            : shareState === "failed"
              ? "Couldn't copy"
              : "Share profile"}
        </button>

        {uploadError && <p className={styles.inlineError}>{uploadError}</p>}
      </header>

      {/* ── Stats ────────────────────────────────────────────────────────── */}
      <div className={styles.statsGrid}>
        {profile.stats.map((stat, i) => {
          const Icon = STAT_ICONS[i % STAT_ICONS.length];
          return (
            <div key={stat.label} className={styles.statCard} data-anim>
              <span className={styles.statIcon}>
                <Icon size={16} />
              </span>
              <span className={styles.statValue}>{stat.value}</span>
              <span className={styles.statLabel}>{stat.label}</span>
            </div>
          );
        })}
      </div>

      {/* ── Top artists ──────────────────────────────────────────────────── */}
      {profile.topArtists.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Your top artists this year</h2>
          <div className={styles.rankList}>
            {profile.topArtists.map((artist, i) => (
              // These were plain divs before — the whole "top artists" list
              // looked tappable and did nothing.
              <Link
                key={artist.id}
                href={`/artist/${artist.id}`}
                className={`${styles.rankRow} pressable`}
              >
                <span className={styles.rank}>{i + 1}</span>
                <div className={`${styles.rankArt} ${styles.rankArtRound}`}>
                  {artist.avatarUrl ? (
                    <img src={artist.avatarUrl} alt="" />
                  ) : (
                    <span className={styles.rankArtFallback}>
                      {initials(artist.name)}
                    </span>
                  )}
                </div>
                <div className={styles.rankInfo}>
                  <span className={styles.rankTitle}>{artist.name}</span>
                  <span className={styles.rankMeta}>
                    {artist.trackCount} {artist.trackCount === 1 ? "song" : "songs"} played
                  </span>
                </div>
                <ChevronRightIcon size={16} className={styles.rankChevron} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Top tracks ───────────────────────────────────────────────────── */}
      {profile.topTracks.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Your top songs this year</h2>
          <div className={styles.rankList}>
            {profile.topTracks.map((track, i) => (
              <Link
                key={track.id}
                href={`/track/${track.id}`}
                className={`${styles.rankRow} pressable`}
              >
                <span className={styles.rank}>{i + 1}</span>
                <div className={styles.rankArt}>
                  {track.coverUrl ? (
                    <img src={track.coverUrl} alt="" />
                  ) : (
                    <span className={styles.rankArtFallback}>
                      <MusicNoteIcon size={16} />
                    </span>
                  )}
                </div>
                <div className={styles.rankInfo}>
                  <span className={styles.rankTitle}>{track.title}</span>
                  <span className={styles.rankMeta}>{track.artist}</span>
                </div>
                <ChevronRightIcon size={16} className={styles.rankChevron} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Playlist visibility ──────────────────────────────────────────── */}
      {playlists.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Your playlists</h2>
          <p className={styles.sectionHint}>
            Public playlists can be found by anyone using search. Everything
            else stays private to you.
          </p>
          <div className={styles.playlistList}>
            {playlists.map((p) => (
              <div key={p.id} className={styles.playlistRow}>
                <Link href={`/playlist/${p.id}`} className={styles.playlistLink}>
                  <div className={styles.rankArt}>
                    {p.coverUrl ? (
                      <img src={p.coverUrl} alt="" />
                    ) : (
                      <span className={styles.rankArtFallback}>
                        <PlaylistIcon size={16} />
                      </span>
                    )}
                  </div>
                  <div className={styles.rankInfo}>
                    <span className={styles.rankTitle}>{p.name}</span>
                    <span className={styles.rankMeta}>
                      {p.trackCount} {p.trackCount === 1 ? "song" : "songs"}
                    </span>
                  </div>
                </Link>
                <button
                  type="button"
                  role="switch"
                  aria-checked={p.isPublic}
                  aria-label={`Make ${p.name} ${p.isPublic ? "private" : "public"}`}
                  className={`${styles.visToggle} ${p.isPublic ? styles.visToggleOn : ""}`}
                  onClick={() => togglePlaylistVisibility(p.id, !p.isPublic)}
                >
                  {p.isPublic ? <GlobeIcon size={14} /> : <LockIcon size={14} />}
                  <span>{p.isPublic ? "Public" : "Private"}</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Account ──────────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Account</h2>
        <div className={styles.card}>
          <div className={styles.cardRow}>
            <span className={styles.cardLabel}>Email</span>
            <span className={styles.cardValue}>{profile.email}</span>
          </div>
          <div className={styles.cardRow}>
            <span className={styles.cardLabel}>Plan</span>
            <span className={styles.cardValue}>{profile.plan}</span>
          </div>
          <Link href="/settings" className={`${styles.cardRow} ${styles.cardLink}`}>
            <span className={styles.cardLabel}>Settings</span>
            <ChevronRightIcon size={16} className={styles.rankChevron} />
          </Link>
        </div>
      </section>

      <button
        type="button"
        className={`${styles.wideBtn} pressable`}
        onClick={handleExport}
        disabled={exporting}
      >
        {exporting ? <span className={styles.spinner} /> : <DownloadIcon size={16} />}
        {exporting ? "Preparing your download…" : "Download my data"}
      </button>

      {/* ── Crop dialog ──────────────────────────────────────────────────── */}
      {cropSrc && (
        <div
          className={styles.cropOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Crop your photo"
          onClick={() => !uploading && setCropSrc(null)}
        >
          <div className={styles.cropModal} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.cropTitle}>Your new photo</h3>
            <p className={styles.cropHint}>
              We&apos;ll take the middle square of this image.
            </p>
            <div className={styles.cropPreview}>
              <img ref={cropImgRef} src={cropSrc} alt="" className={styles.cropImage} />
            </div>
            <div className={styles.cropActions}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setCropSrc(null)}
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={confirmCrop}
                disabled={uploading}
              >
                {uploading ? "Uploading…" : "Use photo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
