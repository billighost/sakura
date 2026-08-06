"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

/* ────────────────────────────────────────────────────────────
   Types — swap for your real API/DB shapes.
──────────────────────────────────────────────────────────── */
type ProfileData = {
  name: string;
  avatarUrl?: string;
  bio: string;
  email: string;
  plan: string;
  memberSince: string; // display string, e.g. "March 2023"
  stats: { label: string; value: string }[];
  topArtists: { id: string; name: string; trackCount: number; avatarUrl?: string }[];
  topTracks: { id: string; title: string; artist: string; coverUrl?: string }[];
};

/* ────────────────────────────────────────────────────────────
   Icons
──────────────────────────────────────────────────────────── */
function CameraIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" strokeLinecap="round" />
    </svg>
  );
}
function HeadphonesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <rect x="1" y="15" width="6" height="7" rx="2" />
      <rect x="17" y="15" width="6" height="7" rx="2" />
    </svg>
  );
}
function DiscIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}
function StreakIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 2s5 5.5 5 10a5 5 0 0 1-10 0c0-1.5 1-3 1-3s1.5 1.5 1.5 3A2.5 2.5 0 0 0 12 17" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}
function LogOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
function MusicNoteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" opacity={0.6}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

// Removed MOCK data

const STAT_ICONS = [ClockIcon, DiscIcon, HeadphonesIcon, ListIcon, StreakIcon];

export default function ProfilePage() {
  const router = import("next/navigation").then(m => m.useRouter).catch(() => (() => ({ push: () => {} })));
  const [routerPush, setRouterPush] = useState<any>(null);
  useEffect(() => {
    import("next/navigation").then(m => setRouterPush(() => m.useRouter().push));
  }, []);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [savingBio, setSavingBio] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bioMax = 160;

  useEffect(() => {
    fetch("/api/profile")
      .then((res) => res.json())
      .then((data) => {
        setProfile(data);
        setBioDraft(data.bio || "");
      });
  }, []);

  function handleAvatarPick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function confirmCrop() {
    if (!cropSrc) return;
    setUploading(true);
    try {
      const res = await fetch(cropSrc);
      const blob = await res.blob();
      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: {
          "Content-Type": blob.type,
        },
        body: blob,
      });
      if (response.ok) {
        const data = await response.json();
        setProfile((p) => p ? { ...p, avatarUrl: data.avatarUrl } : null);
      }
    } finally {
      setUploading(false);
      setCropSrc(null);
    }
  }

  async function saveBio() {
    setSavingBio(true);
    await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bio: bioDraft }),
    });
    setProfile((p) => p ? { ...p, bio: bioDraft } : null);
    setSavingBio(false);
    setEditingBio(false);
  }

  async function handleShare() {
    if (!profile) return;
    try {
      await navigator.clipboard.writeText(`https://sakura.app/u/${profile.name.toLowerCase().replace(/\s+/g, "-")}`);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1800);
    } catch {
      // clipboard unavailable — silently ignore
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const a = document.createElement("a");
      a.href = "/api/export";
      a.download = "sakura-export.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setExporting(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/auth/signout", { method: "POST" });
    if (routerPush) routerPush("/login");
  }

  if (!profile) {
    return <div className={styles.page}>Loading...</div>;
  }

  return (
    <div className={styles.page}>
      {/* ── Hero ── */}
      <div className={styles.heroSection}>
        <div className={styles.heroGradient} />

        <div className={styles.avatarWrapper}>
          {profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatarUrl} alt="" className={styles.avatar} />
          ) : (
            <div className={styles.avatarPlaceholder}>{initials(profile.name)}</div>
          )}
          <button
            type="button"
            className={styles.editAvatarBtn}
            onClick={handleAvatarPick}
            disabled={uploading}
            aria-label="Change profile photo"
          >
            {uploading ? <span className={styles.spinner} /> : <CameraIcon />}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFileChange} />
        </div>

        <h1 className={styles.username} style={{ zIndex: 1 }}>{profile.name}</h1>

        {editingBio ? (
          <div className={styles.bioEdit}>
            <textarea
              className={styles.bioInput}
              rows={2}
              maxLength={bioMax}
              value={bioDraft}
              onChange={(e) => setBioDraft(e.target.value)}
              autoFocus
            />
            <div className={styles.bioCharCount}>{bioDraft.length}/{bioMax}</div>
            <div className={styles.bioActions}>
              <button
                type="button"
                className={styles.bioCancel}
                onClick={() => {
                  setBioDraft(profile.bio);
                  setEditingBio(false);
                }}
              >
                Cancel
              </button>
              <button type="button" className={styles.bioSave} onClick={saveBio} disabled={savingBio}>
                {savingBio ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className={styles.bio} onClick={() => setEditingBio(true)} style={{ zIndex: 1 }}>
            {profile.bio || "Add a bio"}
          </button>
        )}

        <div className={styles.memberSince}>
          <CalendarIcon />
          <span>Member since {profile.memberSince}</span>
        </div>

        <div style={{ position: "relative" }}>
          <button type="button" className={styles.shareBtn} onClick={handleShare}>
            <ShareIcon />
            Share profile
          </button>
          {shareCopied && <div className={styles.tooltip}>Link copied</div>}
        </div>
      </div>

      {/* ── Stats ── */}
      <div className={styles.statsGrid}>
        {profile.stats.map((stat, i) => {
          const Icon = STAT_ICONS[i % STAT_ICONS.length];
          return (
            <div key={stat.label} className={styles.statCard}>
              <div className={styles.statIcon}>
                <Icon />
              </div>
              <div className={styles.statValue}>{stat.value}</div>
              <div className={styles.statLabel}>{stat.label}</div>
            </div>
          );
        })}
      </div>

      {/* ── Top artists ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Top artists this year</h2>
          <span className={styles.sectionCount}>{profile.topArtists.length}</span>
        </div>
        <div className={styles.artistList}>
          {profile.topArtists.map((artist, i) => (
            <div key={artist.id} className={styles.artistItem}>
              <span className={styles.artistRank}>{i + 1}</span>
              <div className={styles.artistAvatar}>
                {artist.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={artist.avatarUrl} alt="" />
                ) : (
                  <div className={styles.artistPlaceholder}>{initials(artist.name)}</div>
                )}
              </div>
              <div className={styles.artistInfo}>
                <div className={styles.artistName}>{artist.name}</div>
                <div className={styles.artistTracks}>{artist.trackCount} tracks played</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Top tracks ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Top tracks this year</h2>
          <span className={styles.sectionCount}>{profile.topTracks.length}</span>
        </div>
        <div className={styles.trackList}>
          {profile.topTracks.map((track, i) => (
            <div key={track.id} className={styles.trackItem}>
              <span className={styles.trackNumber}>{i + 1}</span>
              <div className={styles.trackCover}>
                {track.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={track.coverUrl} alt="" />
                ) : (
                  <div className={styles.trackPlaceholder}>
                    <MusicNoteIcon />
                  </div>
                )}
              </div>
              <div className={styles.trackInfo}>
                <div className={styles.trackTitle}>{track.title}</div>
                <div className={styles.trackArtist}>{track.artist}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Account ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Account</h2>
        </div>
        <div className={styles.accountCard}>
          <div className={styles.accountRow}>
            <span className={styles.accountLabel}>Email</span>
            <span className={styles.accountValue}>{profile.email}</span>
          </div>
          <div className={styles.accountRow}>
            <span className={styles.accountLabel}>Plan</span>
            <span className={styles.accountValue}>{profile.plan}</span>
          </div>
        </div>
      </section>

      <button type="button" className={styles.exportBtn} onClick={handleExport} disabled={exporting}>
        {exporting ? <span className={styles.spinner} /> : <DownloadIcon />}
        {exporting ? "Preparing your export…" : "Export my data"}
      </button>

      <div style={{ height: "0.75rem" }} />

      <button type="button" className={styles.exportBtn} onClick={handleLogout} disabled={loggingOut}>
        {loggingOut ? <span className={styles.spinner} /> : <LogOutIcon />}
        {loggingOut ? "Signing out…" : "Sign out"}
      </button>

      {/* ── Crop modal ── */}
      {cropSrc && (
        <div className={styles.cropOverlay} role="dialog" aria-modal="true">
          <div className={styles.cropModal}>
            <div className={styles.cropPreview}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cropSrc} alt="" className={styles.cropImage} />
            </div>
            <div className={styles.cropActions}>
              <button type="button" className={styles.cropCancel} onClick={() => setCropSrc(null)} disabled={uploading}>
                Cancel
              </button>
              <button type="button" className={styles.cropConfirm} onClick={confirmCrop} disabled={uploading}>
                {uploading ? "Uploading…" : "Use photo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
