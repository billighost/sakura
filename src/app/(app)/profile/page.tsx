"use client";

import { useState, useEffect, useRef } from "react";
import styles from "./page.module.css";

interface Profile {
  username: string;
  email: string;
  avatarUrl?: string;
  bio?: string;
  createdAt?: string;
  playlistCount: number;
  favoriteCount: number;
  historyCount: number;
}

interface Artist {
  id: string;
  name: string;
  coverUrl?: string;
  trackCount: number;
}

interface Track {
  id: string;
  title: string;
  duration: number;
  coverUrl?: string;
  artist: { name: string };
  album?: { title: string };
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cropUrl, setCropUrl] = useState<string | null>(null);
  const [showCrop, setShowCrop] = useState(false);
  const [bioEditing, setBioEditing] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [savingBio, setSavingBio] = useState(false);
  const [listeningHours, setListeningHours] = useState(0);
  const [streak, setStreak] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [topArtists, setTopArtists] = useState<Artist[]>([]);
  const [topTracks, setTopTracks] = useState<Track[]>([]);
  const [shareTooltip, setShareTooltip] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => setProfile(data))
      .catch(() => {})
      .finally(() => setLoading(false));

    fetch("/api/stats/listening-time")
      .then((r) => r.json())
      .then((data) => setListeningHours(data.hours || 0))
      .catch(() => {});

    fetch("/api/stats/streak")
      .then((r) => r.json())
      .then((data) => setStreak(data.streak || 0))
      .catch(() => {});

    fetch("/api/artists?limit=5")
      .then((r) => r.json())
      .then((data) => setTopArtists(data.artists || []))
      .catch(() => {});

    fetch("/api/history?limit=5")
      .then((r) => r.json())
      .then((data) => setTopTracks(data || []))
      .catch(() => {});
  }, []);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCropUrl(reader.result as string);
      setShowCrop(true);
    };
    reader.readAsDataURL(file);
  }

  async function handleCropConfirm() {
    if (!cropUrl) return;
    setShowCrop(false);
    setPreviewUrl(cropUrl);
    setUploading(true);
    try {
      const res = await fetch(cropUrl);
      const blob = await res.blob();
      const file = new File([blob], "avatar.jpg", { type: "image/jpeg" });
      const formData = new FormData();
      formData.append("avatar", file);
      const resp = await fetch("/api/profile/avatar", {
        method: "POST",
        body: formData,
      });
      const data = await resp.json();
      if (data.avatarUrl) {
        setProfile((prev) => (prev ? { ...prev, avatarUrl: data.avatarUrl } : prev));
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  }

  function startEditBio() {
    setBioDraft(profile?.bio || "");
    setBioEditing(true);
  }

  async function saveBio() {
    setSavingBio(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio: bioDraft }),
      });
      if (res.ok) {
        setProfile((prev) => (prev ? { ...prev, bio: bioDraft } : prev));
      }
    } catch (err) {
      console.error("Failed to save bio:", err);
    } finally {
      setSavingBio(false);
      setBioEditing(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/profile/export");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sakura-data-export.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  }

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${profile?.username}'s Profile`, url });
      } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      setShareTooltip(true);
      setTimeout(() => setShareTooltip(false), 2000);
    }
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.heroSection}>
          <div className="skeleton" style={{ width: "clamp(5rem, 20vw, 7rem)", height: "clamp(5rem, 20vw, 7rem)", borderRadius: "50%" }} />
          <div className="skeleton" style={{ width: "8rem", height: "1.25rem", borderRadius: "6px", marginTop: "1rem" }} />
          <div className="skeleton" style={{ width: "6rem", height: "0.875rem", borderRadius: "4px", marginTop: "0.5rem" }} />
        </div>
        <div className={styles.statsGrid}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={styles.statCard}>
              <div className="skeleton" style={{ width: "2rem", height: "2rem", borderRadius: "8px", margin: "0 auto 0.5rem" }} />
              <div className="skeleton" style={{ width: "3rem", height: "1rem", borderRadius: "4px", margin: "0 auto" }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const displayAvatar = previewUrl || profile.avatarUrl;
  const memberSince = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className={styles.page}>
      {showCrop && cropUrl && (
        <div className={styles.cropOverlay} onClick={() => setShowCrop(false)}>
          <div className={styles.cropModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.cropPreview}>
              <img src={cropUrl} alt="Preview" className={styles.cropImage} />
            </div>
            <div className={styles.cropActions}>
              <button className={styles.cropCancel} onClick={() => setShowCrop(false)}>
                Cancel
              </button>
              <button className={styles.cropConfirm} onClick={handleCropConfirm} disabled={uploading}>
                {uploading ? "Uploading..." : "Use Photo"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.heroSection}>
        <div className={styles.heroGradient} />
        <div className={styles.avatarWrapper}>
          {displayAvatar ? (
            <img className={styles.avatar} src={displayAvatar} alt="" />
          ) : (
            <div className={styles.avatarPlaceholder}>
              {profile.username[0].toUpperCase()}
            </div>
          )}
          <button
            className={styles.editAvatarBtn}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "..." : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            style={{ display: "none" }}
          />
        </div>

        <div className={styles.username}>{profile.username}</div>

        {bioEditing ? (
          <div className={styles.bioEdit}>
            <textarea
              className={styles.bioInput}
              value={bioDraft}
              onChange={(e) => setBioDraft(e.target.value)}
              placeholder="Tell us about yourself..."
              rows={3}
              maxLength={200}
            />
            <div className={styles.bioCharCount}>{bioDraft.length}/200</div>
            <div className={styles.bioActions}>
              <button className={styles.bioCancel} onClick={() => setBioEditing(false)}>
                Cancel
              </button>
              <button className={styles.bioSave} onClick={saveBio} disabled={savingBio}>
                {savingBio ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <button className={styles.bio} onClick={startEditBio}>
            {profile.bio || "Click to add a bio..."}
          </button>
        )}

        {memberSince && (
          <div className={styles.memberSince}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            Member since {memberSince}
          </div>
        )}

        <button className={styles.shareBtn} onClick={handleShare}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          Share
          {shareTooltip && <span className={styles.tooltip}>Copied!</span>}
        </button>
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statIcon}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
          <div className={styles.statValue}>{profile.historyCount ?? 0}</div>
          <div className={styles.statLabel}>Played</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statIcon}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <div className={styles.statValue}>{profile.playlistCount ?? 0}</div>
          <div className={styles.statLabel}>Playlists</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statIcon}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
          </div>
          <div className={styles.statValue}>{profile.favoriteCount ?? 0}</div>
          <div className={styles.statLabel}>Liked</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statIcon}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className={styles.statValue}>{listeningHours}h</div>
          <div className={styles.statLabel}>Listening</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statIcon}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <div className={styles.statValue}>{streak}</div>
          <div className={styles.statLabel}>Day Streak</div>
        </div>
      </div>

      {topArtists.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Top Artists</h2>
            <span className={styles.sectionCount}>{topArtists.length}</span>
          </div>
          <div className={styles.artistList}>
            {topArtists.map((artist, i) => (
              <div key={artist.id} className={styles.artistItem}>
                <div className={styles.artistRank}>#{i + 1}</div>
                <div className={styles.artistAvatar}>
                  {artist.coverUrl ? (
                    <img src={artist.coverUrl} alt="" />
                  ) : (
                    <div className={styles.artistPlaceholder}>{artist.name[0]}</div>
                  )}
                </div>
                <div className={styles.artistInfo}>
                  <div className={styles.artistName}>{artist.name}</div>
                  <div className={styles.artistTracks}>{artist.trackCount} tracks</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {topTracks.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Recently Played</h2>
            <span className={styles.sectionCount}>{topTracks.length}</span>
          </div>
          <div className={styles.trackList}>
            {topTracks.map((track, i) => (
              <div key={track.id} className={styles.trackItem}>
                <div className={styles.trackNumber}>{i + 1}</div>
                <div className={styles.trackCover}>
                  {track.coverUrl ? (
                    <img src={track.coverUrl} alt="" />
                  ) : (
                    <div className={styles.trackPlaceholder}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    </div>
                  )}
                </div>
                <div className={styles.trackInfo}>
                  <div className={styles.trackTitle}>{track.title}</div>
                  <div className={styles.trackArtist}>{track.artist?.name}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Account</h2>
        </div>
        <div className={styles.accountCard}>
          <div className={styles.accountRow}>
            <div className={styles.accountLabel}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              Username
            </div>
            <span className={styles.accountValue}>{profile.username}</span>
          </div>
          <div className={styles.accountRow}>
            <div className={styles.accountLabel}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              Email
            </div>
            <span className={styles.accountValue}>{profile.email}</span>
          </div>
          <div className={styles.accountRow}>
            <div className={styles.accountLabel}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              Member Since
            </div>
            <span className={styles.accountValue}>{memberSince}</span>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <button
          className={styles.exportBtn}
          onClick={handleExport}
          disabled={exporting}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          {exporting ? "Exporting..." : "Export My Data"}
        </button>
      </div>
    </div>
  );
}
