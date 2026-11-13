"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useMusic } from "./MusicContext";
import { SongGesture } from "./SongGesture";
import { Icon } from "./Icon";
import { useScreenActions } from "./screenActions";
import { loadResource, resourceSnapshot } from "./resources";
import { musicTrack, type MusicTrack } from "./types";
import { MixPlaylistDialog } from "./MixPlaylistDialog";
import type { SongMenuAnchor } from "./TrackActions";
import menuStyles from "./touch.module.css";
import s from "./collection-gesture.module.css";

type CollectionKind = "mix" | "playlist" | "album" | "artist";
type CollectionAction = "play" | "shuffle" | "queue" | "download" | "playlist";

function CollectionOptions({ title, kind, href, anchor, trigger, onClose, onAction }: {
 title: string;
 kind: CollectionKind;
 href: string;
 anchor: SongMenuAnchor;
 trigger: HTMLButtonElement | null;
 onClose: () => void;
 onAction: (action: CollectionAction) => void;
}) {
 const music = useMusic(), headingId = useId(), menu = useRef<HTMLDivElement>(null), close = useRef(onClose);
 useLayoutEffect(() => { close.current = onClose; }, [onClose]);
 useLayoutEffect(() => {
  const element = menu.current;
  if (!element) return;
  const previous = document.activeElement;
  const openedAt = trigger?.getBoundingClientRect();
  const place = () => {
   const gap = 10, viewport = window.visualViewport;
   const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
   const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
   element.style.left = `${Math.max(left + gap, Math.min(left + width - element.offsetWidth - gap, anchor.left))}px`;
   element.style.top = `${Math.max(top + gap, Math.min(top + height - element.offsetHeight - gap, anchor.top + anchor.height + gap))}px`;
  };
  if (element.showPopover) element.showPopover(); else element.style.display = "block";
  place();
  element.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  const resize = new ResizeObserver(place); resize.observe(element);
   const outside = (event: Event) => { if (event.target instanceof Node && !element.contains(event.target) && !trigger?.contains(event.target)) close.current(); };
  const scroll = (event: Event) => {
   if (event.target instanceof Node && element.contains(event.target)) return;
   // Scrolling a trigger into view updates layout before its scroll event is
   // delivered. Ignore that queued event; dismiss only if the anchor has moved
   // since the menu opened, including keyboard and scrollbar scrolling.
   const current = trigger?.getBoundingClientRect();
   if (openedAt && current && Math.abs(current.top - openedAt.top) < .5 && Math.abs(current.left - openedAt.left) < .5) return;
   close.current();
  };
  // Touch release can restore focus to the held card after opening the menu.
  // Escape must still dismiss this manual popover from that focused card.
  const escape = (event: globalThis.KeyboardEvent) => {if(event.key === "Escape" && !event.defaultPrevented){event.preventDefault();event.stopPropagation();close.current();}};
  document.addEventListener("pointerdown", outside);
  document.addEventListener("keydown", escape);
  document.addEventListener("scroll", scroll, true);
  window.addEventListener("resize", place);
  window.visualViewport?.addEventListener("resize", place);
  return () => {
   resize.disconnect(); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); document.removeEventListener("scroll", scroll, true);
   window.removeEventListener("resize", place); window.visualViewport?.removeEventListener("resize", place);
   const restore = element.contains(document.activeElement) || document.activeElement === document.body;
   if (element.matches(":popover-open")) element.hidePopover();
   if (restore && previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
  };
  }, [anchor, trigger]);
 function keyboard(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
  if (event.key === "Tab") { event.stopPropagation(); onClose(); return; }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
 }
  return createPortal(<div ref={menu} popover="manual" role="menu" aria-label={`Options for ${title}`} aria-labelledby={headingId} className={menuStyles.songPopover} data-motion={music.settings.reducedMotion ? "still" : undefined} onKeyDown={keyboard} onToggle={event => { if (event.newState === "closed") onClose(); }}>
  <div className={menuStyles.popoverHeading}><span>{kind} options</span><strong id={headingId}>{title}</strong></div>
  <Link role="menuitem" href={href} onClick={onClose}><Icon name="arrow"/>Open {kind}</Link>
  <button type="button" role="menuitem" onClick={() => onAction("play")}><Icon name="play"/>Play now</button>
  <button type="button" role="menuitem" onClick={() => onAction("shuffle")}><Icon name="shuffle"/>Shuffle these songs</button>
  <button type="button" role="menuitem" onClick={() => onAction("queue")}><Icon name="queue"/>Add songs to queue</button>
  <button type="button" role="menuitem" onClick={() => onAction("download")}><Icon name="download"/>Save songs on this device</button>
  {kind === "mix" && <button type="button" role="menuitem" onClick={() => onAction("playlist")}><Icon name="plus"/>Make a playlist</button>}
 </div>, document.body);
}

/** Shared card options preserve ordinary navigation and use the same actions on every input device. */
export function CollectionGesture({ children, className = "", kind, id, title, tracks }: {
 children: ReactNode;
 className?: string;
 kind: CollectionKind;
 id: string;
 title: string;
 tracks?: MusicTrack[];
}) {
 const music = useMusic(), actions = useScreenActions(music.account?.id, `${kind}:${id}`);
 const trigger = useRef<HTMLButtonElement>(null);
 const [anchor, setAnchor] = useState<SongMenuAnchor | null>(null), [busy, setBusy] = useState(false), [playlistTracks, setPlaylistTracks] = useState<MusicTrack[] | null>(null);
 const href = `/${kind}/${encodeURIComponent(id)}`;
 async function action(value: CollectionAction) {
  setAnchor(null);
  const controller = actions.begin("collection"); if (!controller) return;
  setBusy(true);
  try {
   let queue = tracks;
   if (!queue) {
    const endpoint = kind === "mix" ? "mixes" : kind === "playlist" ? "playlists" : kind === "album" ? "albums" : "artists";
    const accountId=music.account?.id;if(!accountId)return;
    const path=`/api/v2/${endpoint}/${encodeURIComponent(id)}`;
    // Share the page's durable cache and flight. Cancelling this menu action
    // must not cancel another screen's use of the same collection.
    await loadResource(accountId,path,{signal:controller.signal,kind:"visible"});
    if(!actions.current("collection",controller))return;
    const snapshot=resourceSnapshot<Record<string,unknown>>(accountId,path);
    if(snapshot.error&&snapshot.data===undefined)throw snapshot.error;
    const data=snapshot.data;
    if(!data)throw new Error("This collection has not been saved on this device yet.");
    const rows = data.recordings ?? data.tracks;
    queue = Array.isArray(rows) ? rows.map(row => musicTrack(row as Record<string, unknown>)) : [];
   }
   if (!actions.current("collection", controller)) return;
   const unique = [...new Map(queue.map(track => [music.effectiveId(track), track])).values()];
   if (!unique.length) throw new Error("This collection has no songs ready yet.");
   if (value === "playlist") setPlaylistTracks(unique);
   else if (value === "queue") { unique.forEach(music.addQueue); music.notify(`${unique.length} songs added to your queue.`); }
   else if (value === "download") unique.forEach(music.requestDownload);
   else { if (value === "shuffle") music.setShuffle(true); music.play(unique[value === "shuffle" ? Math.floor(Math.random() * unique.length) : 0], unique); }
  } catch (error) {
   if (actions.current("collection", controller)) music.reportError(error, value === "download" ? "save" : "playback", () => void action(value));
  } finally { if (actions.finish("collection", controller)) setBusy(false); }
 }
 return <SongGesture id={`${kind}:${id}`} label={title} entity="collection" className={`${s.card} ${className}`} onOptions={value => setAnchor(value)}>
  {children}
  <button ref={trigger} type="button" className={s.options} aria-label={`More options for ${title}`} aria-haspopup="menu" aria-expanded={!!anchor} disabled={busy} title={`Options for ${title} · right-click or Shift+F10`} onClick={event => { if (anchor) { setAnchor(null); return; } const rect = event.currentTarget.getBoundingClientRect(); setAnchor({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }); }}><Icon name="more" size={18}/></button>
  {anchor && <CollectionOptions title={title} kind={kind} href={href} anchor={anchor} trigger={trigger.current} onClose={() => setAnchor(null)} onAction={value => void action(value)}/>}
  {playlistTracks && kind === "mix" && <MixPlaylistDialog mixId={id} mixName={title} tracks={playlistTracks} onClose={() => setPlaylistTracks(null)}/>}
 </SongGesture>;
}
