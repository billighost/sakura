"use client";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import s from "./player.module.css";
import { sameOriginArtworkUrl } from "./imageUrl";
import { retainArtwork } from "./imageCache";
import { useMusic } from "../app/MusicContext";
import { RecoveryNotice } from "../app/RecoveryNotice";
import { UserFacingError } from "../app/errors";
import { useDialogLifecycle } from "../app/dialogLifecycle";

export type PlayerIconName = "play" | "pause" | "next" | "previous" | "close" | "up" | "down" | "heart" | "queue" | "lyrics" | "share" | "download" | "shuffle" | "repeat" | "volume" | "check" | "link" | "image" | "video" | "back";
const paths: Record<PlayerIconName, ReactNode> = {
  play: <path d="m8 5 11 7-11 7Z"/>, pause: <><path d="M8 5v14M16 5v14"/></>,
  next: <><path d="m5 5 10 7-10 7ZM19 5v14"/></>, previous: <><path d="m19 5-10 7 10 7ZM5 5v14"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>, up: <path d="m6 15 6-6 6 6"/>, down: <path d="m6 9 6 6 6-6"/>,
  heart: <path d="M20 5.5c-3-3-6-1-8 1-2-2-5-4-8-1C-1 10 6 16 12 21c6-5 13-11 8-15.5Z"/>,
  queue: <><path d="M4 6h16M4 11h12M4 16h9m4-2 5 3-5 3Z"/></>,
  lyrics: <><path d="M5 5h14v12H9l-4 4ZM8 9h8M8 13h6"/></>,
  share: <><circle cx="18" cy="5" r="3"/><circle cx="5" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8 10 7-4m-7 8 7 4"/></>,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>,
  shuffle: <path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 4-3 5-6m3-4c1-2 3-2 4-2h3m-4-4 4 4-4 4"/>,
  repeat: <path d="m16 2 4 4-4 4M4 12V9a3 3 0 0 1 3-3h13M8 22l-4-4 4-4m12-2v3a3 3 0 0 1-3 3H4"/>,
  volume: <><path d="M3 9h4l5-4v14l-5-4H3ZM16 8a6 6 0 0 1 0 8m3-12a11 11 0 0 1 0 16"/></>,
  check: <path d="m4 12 5 5L20 6"/>, link: <><path d="m9 15 6-6m-7 3-2 2a4 4 0 0 0 6 6l3-3m1-5 2-2a4 4 0 0 0-6-6l-3 3"/></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/></>,
  video: <><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/></>,
  back: <path d="m15 5-7 7 7 7"/>,
};
export function PlayerIcon({ name, size = 20 }: { name: PlayerIconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
export function IconButton({ icon, label, active, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: PlayerIconName; label: string; active?: boolean }) {
  return <button type="button" {...props} aria-label={label} title={label} aria-pressed={active} className={`${s.iconButton} ${active ? s.active : ""} ${className}`}><PlayerIcon name={icon}/></button>;
}
export function PlayerButton({ icon, children, secondary, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: PlayerIconName; secondary?: boolean }) {
  return <button type="button" {...props} className={`${s.button} ${secondary ? s.secondary : ""} ${props.className || ""}`}>{icon && <PlayerIcon name={icon} size={18}/>}<span>{children}</span></button>;
}
export function Artwork({ url, title, className = "", priority = false }: { url: string | null | undefined; title: string; className?: string; priority?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const src = sameOriginArtworkUrl(url);
  useEffect(() => {
    if (!src) return;
    void retainArtwork(src, priority).catch(() => undefined);
  }, [src, priority]);
  return <div className={`${s.artwork} ${className}`}>
    {src && failedUrl !== src ? <img src={src} alt={`${title} artwork`} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" onError={() => setFailedUrl(src)}/> : <svg viewBox="0 0 300 300" aria-label={`${title}: artwork unavailable`} role="img"><rect width="300" height="300" fill="currentColor" opacity=".08"/><g fill="none" stroke="currentColor" strokeWidth="1.7" opacity=".5"><path d="M55 252C122 224 194 138 213 51M125 199C76 172 75 133 62 109c41 8 81 23 94 50M169 140c-6-55 17-88 35-104 4 37 10 65-21 90M202 89c23-24 51-25 72-22-13 25-29 40-66 33"/><path d="M101 199c29-39 51-41 77-48M161 150c37 7 49 16 67 41-39 2-64-8-65-32"/></g><text x="150" y="269" textAnchor="middle" fill="currentColor" opacity=".55" fontSize="17" fontFamily="Georgia,serif">a little good sound.</text></svg>}
  </div>;
}
export function PlayerDialog({ title, subtitle, children, footer, onClose, wide = false, fullscreen = false, className = "", appearance = "note", closeDisabled = false }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean; fullscreen?: boolean; className?: string; appearance?: "player" | "lyrics" | "queue" | "share" | "note"; closeDisabled?: boolean }) {
  const music = useMusic();
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const titleId = useId();
  const animateClose = useDialogLifecycle(ref, onClose, music.settings.reducedMotion);
  const requestClose = () => { if (!closeDisabled) animateClose(); };
  return <dialog ref={ref} className={`${s.dialog} ${wide ? s.wide : ""} ${fullscreen ? s.fullscreen : ""} ${className}`} data-dialog-appearance={appearance} data-reduced-motion={music.settings.reducedMotion || undefined} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); requestClose(); }} onPointerDown={(event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    backdropPress.current = event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  }} onClick={(event) => {
    const beganOnBackdrop = backdropPress.current;
    backdropPress.current = false;
    if (event.target !== event.currentTarget || !beganOnBackdrop) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) requestClose();
  }}><section className={s.dialogInner}><header className={s.dialogHeader}><div>{subtitle && <p className={s.eyebrow}>{subtitle}</p>}<h2 id={titleId}>{title}</h2></div><IconButton icon="close" label="Close" onClick={requestClose} disabled={closeDisabled}/></header><div className={s.dialogBody} data-player-scroll>{music.notice&&<div className={s.dialogNotice}><RecoveryNotice error={new UserFacingError(music.notice.issue)} retry={music.notice.retry} compact/><IconButton icon="close" label="Dismiss message" onClick={music.dismissNotice}/></div>}{children}</div>{footer && <footer className={s.dialogFooter}>{footer}</footer>}</section></dialog>;
}
export function formatPlaybackTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
