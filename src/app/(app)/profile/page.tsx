"use client";

import { useState, useEffect, useRef } from "react";
import styles from "./page.module.css";

interface Profile {
  username: string;
  email: string;
  avatarUrl?: string;
  bio?: string;
  createdAt?: string;
  _count: {
    playlists: number;
    favorites: number;
    listeningHistory: number;
  };
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

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.avatarSection}>
          <div className="skeleton" style={{ width: "clamp(4.5rem, 18vw, 6rem)", height: "clamp(4.5rem, 18vw, 6rem)", borderRadius: "50%" }} />
          <div className="skeleton" style={{ width: "6rem", height: "1rem", borderRadius: "4px", marginTop: "0.75rem" }} />
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const displayAvatar = previewUrl || profile.avatarUrl;
  const memberSince = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString("en-US", {
        month: "short",
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

      <div className={styles.avatarSection}>
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
            {uploading ? "..." : "+"}
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
            />
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
          <div className={styles.bio} onClick={startEditBio}>
            {profile.bio || "Click to add a bio..."}
          </div>
        )}

        {memberSince && (
          <div className={styles.memberSince}>Member since {memberSince}</div>
        )}
      </div>

      <div className={styles.stats}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{profile._count.listeningHistory}</div>
          <div className={styles.statLabel}>Played</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{profile._count.playlists}</div>
          <div className={styles.statLabel}>Playlists</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{profile._count.favorites}</div>
          <div className={styles.statLabel}>Liked</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{listeningHours}h</div>
          <div className={styles.statLabel}>Listening</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{streak}</div>
          <div className={styles.statLabel}>Day Streak</div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Account</div>
        <div className={styles.accountCard}>
          <div className={styles.accountRow}>
            <span className={styles.accountLabel}>Username</span>
            <span className={styles.accountValue}>{profile.username}</span>
          </div>
          <div className={styles.accountRow}>
            <span className={styles.accountLabel}>Email</span>
            <span className={styles.accountValue}>{profile.email}</span>
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
