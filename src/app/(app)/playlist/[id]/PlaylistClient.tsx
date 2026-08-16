"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlayer } from "@/components/PlayerContext";
import { useAppNav } from "@/components/AppNavContext";
import { Sheet } from "@/components/Sheet";
import {
  CollectionDetail,
  DetailTrack,
  OwnerByline,
  VisibilityToggle,
} from "@/components/CollectionDetail";
import { EditIcon, ShareIcon, TrashIcon } from "@/components/Icons";
import { haptic } from "@/lib/haptics";
import styles from "./page.module.css";

/**
 * A playlist you own — or a public one somebody shared with you.
 *
 * The page shape lives in <CollectionDetail>, shared with mixes and system
 * playlists. This file is what's genuinely specific: the edit sheet, delete, and
 * the visibility control.
 *
 * Three things here were broken rather than merely undesigned:
 *
 *  - Editing sent `PUT` to /api/playlists/[id], which exports GET, PATCH and
 *    DELETE. Every rename returned 405 and the sheet showed "Failed to update
 *    playlist" with no way to tell that the request never had a handler.
 *  - The empty state's "Add tracks" button opened a dialog reading "Search for
 *    tracks to add to this playlist" whose only control was "Close". It went
 *    nowhere. It now goes to search.
 *  - The fetch was `.then(r => r.json())` with no status check, so a 404 body
 *    ({ error: "Playlist not found" }) was set as the playlist and the next line
 *    read `.tracks.length` off it. The page crashed rather than saying anything.
 */

interface Playlist {
  id: string;
  name: string;
  description?: string | null;
  coverUrl?: string | null;
  isPublic?: boolean;
  isOwner?: boolean;
  ownerName?: string | null;
  tracks: DetailTrack[];
}

/** Covers are stored either as a URL or as a JSON array of them, for mosaics. */
function parseCovers(coverUrl: string | null | undefined): string[] {
  if (!coverUrl) return [];
  if (!coverUrl.startsWith("[")) return [coverUrl];
  try {
    const parsed = JSON.parse(coverUrl);
    return Array.isArray(parsed) ? parsed.filter((u) => typeof u === "string") : [coverUrl];
  } catch {
    return [coverUrl];
  }
}

export default function PlaylistClient({ id }: { id: string }) {
  const { back } = useAppNav();
  const { showToast } = usePlayer();

  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/playlists/${id}`);
        if (res.status === 404) throw new Error("not-found");
        if (!res.ok) throw new Error("failed");
        const data: Playlist = await res.json();
        if (!cancelled) setPlaylist(data);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message === "not-found"
            ? "This playlist doesn't exist, or it isn't shared with you."
            : "We couldn't load this playlist. Check your connection and try again."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  const covers = useMemo(() => parseCovers(playlist?.coverUrl), [playlist?.coverUrl]);
  const isOwner = playlist?.isOwner !== false;

  const handleReorder = useCallback(
    async (trackIds: string[]) => {
      try {
        const res = await fetch(`/api/playlists/${id}/tracks`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackIds }),
        });
        if (!res.ok) throw new Error("failed");
      } catch {
        // CollectionDetail holds the new order locally. Re-fetching is what puts
        // the list back where the server thinks it is, rather than leaving the
        // user looking at an order that didn't save.
        showToast("Couldn't save the new order", "error");
        setReloadKey((k) => k + 1);
      }
    },
    [id, showToast]
  );

  const handleRemoveTrack = useCallback(
    async (trackId: string) => {
      const previous = playlist;
      // Optimistic, with the previous list kept for the rollback.
      setPlaylist((p) => (p ? { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) } : p));
      try {
        const res = await fetch(`/api/playlists/${id}/tracks`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackId }),
        });
        if (!res.ok) throw new Error("failed");
        haptic("success");
      } catch {
        setPlaylist(previous);
        showToast("Couldn't remove that song", "error");
      }
    },
    [id, playlist, showToast]
  );

  const handleVisibility = useCallback(
    async (next: boolean) => {
      const previous = playlist;
      setPlaylist((p) => (p ? { ...p, isPublic: next } : p));
      try {
        const res = await fetch(`/api/playlists/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPublic: next }),
        });
        if (!res.ok) throw new Error("failed");
        showToast(next ? "Anyone with the link can play this" : "Back to private");
      } catch {
        setPlaylist(previous);
        showToast("Couldn't change who can see this", "error");
      }
    },
    [id, playlist, showToast]
  );

  const handleShare = useCallback(async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: playlist?.name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast("Link copied");
    } catch (err) {
      // A dismissed share sheet rejects with AbortError. Not a failure.
      if (err instanceof Error && err.name === "AbortError") return;
      showToast("Couldn't share that link", "error");
    }
  }, [playlist?.name, showToast]);

  function openEdit() {
    if (!playlist) return;
    setEditName(playlist.name);
    setEditDescription(playlist.description ?? "");
    setEditError(null);
    setEditOpen(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editName.trim()) return;
    setSaving(true);
    setEditError(null);
    try {
      // PATCH, not PUT. See the note at the top of this file.
      const res = await fetch(`/api/playlists/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setEditError(data?.error ?? "Couldn't save those changes. Try again.");
        return;
      }
      // PATCH answers { ok: true } rather than the row, so apply locally.
      setPlaylist((p) =>
        p
          ? { ...p, name: editName.trim(), description: editDescription.trim() || null }
          : p
      );
      setEditOpen(false);
      haptic("success");
    } catch {
      setEditError("Couldn't save those changes. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/playlists/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      setDeleteOpen(false);
      back("/library");
    } catch {
      showToast("Couldn't delete this playlist", "error");
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  const songCount = playlist?.tracks.length ?? 0;

  return (
    <>
      <CollectionDetail
        eyebrow="Playlist"
        title={playlist?.name ?? "Playlist"}
        description={playlist?.description}
        coverUrls={covers}
        tracks={playlist?.tracks ?? []}
        provenance={
          isOwner
            ? songCount > 0
              ? `${songCount} song${songCount === 1 ? "" : "s"} you added`
              : "Yours to fill"
            : "Shared with you"
        }
        backFallback="/library"
        loading={loading}
        error={error}
        onRetry={() => setReloadKey((k) => k + 1)}
        numbered
        onReorder={isOwner ? handleReorder : undefined}
        onRemoveTrack={isOwner ? handleRemoveTrack : undefined}
        empty={{
          title: "No songs yet",
          body: "Find something you like and add it from the song's menu. It'll show up here.",
          action: { href: "/search", label: "Find songs" },
        }}
        heroExtra={
          isOwner ? (
            <VisibilityToggle
              isPublic={Boolean(playlist?.isPublic)}
              onChange={handleVisibility}
            />
          ) : playlist?.ownerName ? (
            <OwnerByline name={playlist.ownerName} />
          ) : undefined
        }
        actions={
          <>
            <button
              type="button"
              className={`${styles.iconBtn} pressable`}
              onClick={handleShare}
              aria-label="Share this playlist"
            >
              <ShareIcon size={16} />
            </button>

            {/* Only an owner gets the verbs. A shared playlist you're visiting
                shows nothing you can't actually do. */}
            {isOwner && (
              <>
                <button
                  type="button"
                  className={`${styles.iconBtn} pressable`}
                  onClick={openEdit}
                  aria-label="Rename this playlist"
                >
                  <EditIcon size={16} />
                </button>
                <button
                  type="button"
                  className={`${styles.iconBtn} ${styles.iconBtnDanger} pressable`}
                  onClick={() => setDeleteOpen(true)}
                  aria-label="Delete this playlist"
                >
                  <TrashIcon size={16} />
                </button>
              </>
            )}
          </>
        }
      />

      <Sheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Rename playlist"
        variant="dialog"
        dismissible={!saving}
      >
        <form onSubmit={handleSaveEdit} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="pl-name" className={styles.label}>
              Name
            </label>
            <input
              id="pl-name"
              className={styles.input}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Late night drives"
              maxLength={100}
              required
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="pl-desc" className={styles.label}>
              Description <span className={styles.optional}>(optional)</span>
            </label>
            <textarea
              id="pl-desc"
              className={`${styles.input} ${styles.textarea}`}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="What's this one for?"
              maxLength={500}
              rows={3}
            />
          </div>

          {editError && (
            <p className={styles.formError} role="alert">
              {editError}
            </p>
          )}

          <div className={styles.formActions}>
            <button
              type="button"
              className={`${styles.btnQuiet} pressable`}
              onClick={() => setEditOpen(false)}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`${styles.btnPrimary} pressable`}
              disabled={saving || !editName.trim()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Sheet>

      <Sheet
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this playlist?"
        variant="dialog"
        dismissible={!deleting}
      >
        <p className={styles.confirmBody}>
          “{playlist?.name}” will be gone for good. The songs themselves stay in
          your library.
        </p>
        <div className={styles.formActions}>
          <button
            type="button"
            className={`${styles.btnQuiet} pressable`}
            onClick={() => setDeleteOpen(false)}
            disabled={deleting}
          >
            Keep it
          </button>
          <button
            type="button"
            className={`${styles.btnDanger} pressable`}
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete playlist"}
          </button>
        </div>
      </Sheet>
    </>
  );
}
