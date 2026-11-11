"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MusicTrack } from "./types";
import { useMusic } from "./MusicContext";

export function albumHref(track: Pick<MusicTrack, "albumId" | "albumReference">) {
  if (track.albumId) return "/album/" + encodeURIComponent(track.albumId);
  const ref = track.albumReference;
  return ref && ["deezer", "spotify"].includes(ref.provider) && ref.id
    ? "/album/" + encodeURIComponent(`${ref.provider}:${ref.id}`) : null;
}

export function AlbumLink({ track, className, onNavigate }: { track: Pick<MusicTrack, "albumId" | "albumReference" | "albumTitle">; className?: string; onNavigate?: () => void }) {
  const music=useMusic();
  const router=useRouter();
  if (!track.albumTitle) return null;
  const href = albumHref(track);
  return href ? <Link href={href} className={className} data-album-link dir="auto" onClick={event => {
    event.stopPropagation();
    if(event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){
      // Closing a dialog unmounts its Link. Dispatch navigation through the
      // router first so that unmount cannot cancel Link's own navigation.
      event.preventDefault();router.push(href);onNavigate?.();music.closeModal();
    }
  }}>{track.albumTitle}</Link>
    : <span className={className} dir="auto">{track.albumTitle}</span>;
}
