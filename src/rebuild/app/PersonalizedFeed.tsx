"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMusic } from "./MusicContext";
import { musicTrack, type MusicTrack, type UserSettings } from "./types";
import { Artwork, Button, TrackMenu, time } from "./Elements";
import { ArtistLinks } from "./ArtistLinks";
import { Blossom } from "./Brand";
import { Icon, type IconName } from "./Icon";
import { SongGesture } from "./SongGesture";
import { SmartQueueButton } from "./SmartQueueButton";
import { RecoveryNotice } from "./RecoveryNotice";
import { UserFacingError } from "./errors";
import { recommendationJson } from "./recommendationTransport";
import { feedTasteKey, feedViewKey } from "./feedIdentity";
import {browserOffline} from "./resourcePolicy";
import {clearRecommendationCache,readRecommendationCache,recommendationCacheValid,recommendationCacheVersion,writeRecommendationCache} from "./recommendationCache";
import type { SongMenuAnchor } from "./TrackActions";
import { appendUniqueFeedItems } from "./feedItems";
import { HeroGarden } from "./HeroGarden";
import {useHeroRecommendation} from "./useHeroRecommendation";
import {useVisibleMotion} from "./useVisibleMotion";
import s from "./personalized-feed.module.css";

type Surface = "home" | "discover";
type Mode = "balanced" | "familiar" | "explore";
type Lane = "familiar" | "similar" | "explore" | "fresh";
interface FeedItem { track: MusicTrack; reason: string; lane: Lane }
interface FeedSection { id: string; title: string; description: string; tracks: MusicTrack[] }
interface FeedSource { context: "home-feed" | "discover-feed"; contextId?: string }
interface FeedState {
  items: FeedItem[]; sections: FeedSection[]; nextCursor: string | null; ready: boolean;
  busy: boolean; error: unknown; refreshRequired: boolean; personalized: boolean;
  totalCandidates: number; generatedAt: string;
}
interface CachedFeed { state: FeedState; savedAt: number }
// Keep the full visited selection, including paginated songs, in memory and on
// this device so reopening Home or Discover offline restores the same cards.
const visitedFeeds = new Map<string, CachedFeed>();
const CACHE_LIFETIME = 20 * 60 * 1000;
const PAGE_SIZE = 12;
// One wide sleeve and ten single cards fill both two- and three-column layouts.
const CHAPTER_SIZE = 11;
const lanes: Record<Lane, { label: string; icon: IconName }> = {
  familiar: { label: "A familiar song", icon: "heart" },
  similar: { label: "Related to your listening", icon: "discover" },
  explore: { label: "Something new", icon: "discover" },
  fresh: { label: "From a recent album", icon: "sun" },
};

function emptyFeed(): FeedState {
  return { items: [], sections: [], nextCursor: null, ready: false, busy: true, error: null,
    refreshRequired: false, personalized: false, totalCandidates: 0, generatedAt: "" };
}
function cachedFeed(key: string): FeedState {
  const saved = visitedFeeds.get(key);
  return saved && recommendationCacheValid(key.split(":",1)[0],saved.savedAt)&&(browserOffline()||Date.now() - saved.savedAt < CACHE_LIFETIME)
    ? { ...saved.state, busy: false, error: null, refreshRequired: false } : emptyFeed();
}
function saveFeed(accountId:string,key: string, state: FeedState,version:number) {
  visitedFeeds.delete(key);
  const data={...state,busy:false,error:null},savedAt=Math.max(Date.now(),version+1);
  visitedFeeds.set(key, { state:data, savedAt });
  void writeRecommendationCache(accountId,"feed:"+key,data,version);
  while (visitedFeeds.size > 8) visitedFeeds.delete(visitedFeeds.keys().next().value!);
}
function asTrack(value: unknown): MusicTrack | null {
  try { return value && typeof value === "object" ? musicTrack(value as Record<string, unknown>) : null; }
  catch { return null; }
}
function parseFeed(raw: Record<string, unknown>): Pick<FeedState, "items" | "sections" | "nextCursor" | "personalized" | "totalCandidates" | "generatedAt"> {
  if (!Array.isArray(raw.items)) throw new Error("Feed response unavailable");
  const items = raw.items.flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>, track = asTrack(item.track);
    if (!track) return [];
    const lane = typeof item.lane === "string" && item.lane in lanes ? item.lane as Lane : "similar";
    return [{ track, lane, reason: typeof item.reason === "string" ? item.reason : "Selected for your recommendations." }];
  });
  const sections = Array.isArray(raw.sections) ? raw.sections.flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const section = value as Record<string, unknown>;
    if (typeof section.id !== "string" || typeof section.title !== "string" || !Array.isArray(section.tracks)) return [];
    const tracks = section.tracks.map(asTrack).filter((track): track is MusicTrack => !!track);
    return tracks.length ? [{ id: section.id, title: section.title,
      description: typeof section.description === "string" ? section.description : "", tracks }] : [];
  }) : [];
  return { items, sections, nextCursor: typeof raw.nextCursor === "string" ? raw.nextCursor : null,
    personalized: raw.personalized === true, totalCandidates: Math.max(0, Number(raw.totalCandidates) || 0),
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "" };
}
function clearAccountFeeds(accountId: string,invalidate=true) {
  if(invalidate)clearRecommendationCache(accountId);
  for (const key of visitedFeeds.keys()) if (key.startsWith(accountId + ":")) visitedFeeds.delete(key);
}

/** Fill the same cache the visible feed consumes before its route opens. */
export async function prefetchPersonalizedFeed(accountId: string, surface: Surface, settings: UserSettings, signal: AbortSignal, mode: Mode = "balanced") {
  signal.throwIfAborted();
  if (browserOffline()) return;
  const cacheKey = feedViewKey(accountId, surface, mode, settings), version = recommendationCacheVersion(accountId);
  if (cachedFeed(cacheKey).ready) return;
  const saved = await readRecommendationCache<FeedState>(accountId, "feed:" + cacheKey);
  signal.throwIfAborted();
  if (saved?.data.ready && Array.isArray(saved.data.items) && Array.isArray(saved.data.sections) && Date.now() - saved.savedAt < CACHE_LIFETIME) {
    if (recommendationCacheVersion(accountId) === version) visitedFeeds.set(cacheKey, { state: saved.data, savedAt: saved.savedAt });
    return;
  }
  const params = new URLSearchParams({ surface, mode, limit: String(PAGE_SIZE) });
  const raw = await recommendationJson(accountId, "/api/v2/feed?" + params, signal, { identity: cacheKey, acceptStatuses: [409, 410] });
  signal.throwIfAborted();
  if (recommendationCacheVersion(accountId) !== version || typeof raw.error === "string") return;
  const state: FeedState = { ...parseFeed(raw), ready: true, busy: false, error: null, refreshRequired: false };
  saveFeed(accountId, cacheKey, state, version);
}

export function PersonalizedFeed({ surface, children }: { surface: Surface; children?: ReactNode }) {
  const music = useMusic();
  const settings = music.settings;
  const tasteKey = feedTasteKey(settings);
  return <FeedRoom key={(music.account?.id || "guest") + ":" + surface + ":" + tasteKey}
    surface={surface} tasteKey={tasteKey}>{children}</FeedRoom>;
}

function FeedRoom({ surface, tasteKey, children }: { surface: Surface; tasteKey: string; children?: ReactNode }) {
  const music = useMusic();
  const accountId = music.account?.id || "";
  const [mode, setMode] = useState<Mode>("balanced");
  return <FeedView key={mode} surface={surface} mode={mode} onMode={setMode}
    cacheKey={accountId + ":" + surface + ":" + mode + ":" + tasteKey}>{children}</FeedView>;
}

function FeedView({ surface, mode, onMode, cacheKey, children }: {
  surface: Surface; mode: Mode; onMode: (mode: Mode) => void; cacheKey: string; children?: ReactNode;
}) {
  const music = useMusic();
  const accountId = music.account?.id || "";
  const home = surface === "home";
  const [feed, setFeed] = useState<FeedState>(() => cachedFeed(cacheKey));
  const feedRef = useRef(feed);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const seenCursors = useRef(new Set<string>());
  const sentinel = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ track: MusicTrack; anchor: SongMenuAnchor } | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const explanationId = useId();
  const heroPickRef=useRef<FeedItem|null>(null);
  const hero=useHeroRecommendation({accountId,cacheKey,surface,mode,hold:()=>{
    const shown=heroPickRef.current;
    const engaged=shown&&music.track&&music.effectiveId(shown.track)===music.effectiveId(music.track)&&["playing","buffering","resolving"].includes(music.status);
    const artwork=root.current?.querySelector("[data-hero-music]");
    return !!engaged||!!(shown&&menu?.track.id===shown.track.id)||!!(artwork&&document.activeElement&&artwork.contains(document.activeElement));
  }});
  const releaseHero=hero.release;
  useEffect(()=>releaseHero(),[music.status,music.track,menu,releaseHero]);

  const load = useCallback(async (reset = false) => {
    if (!accountId || request.current && !reset) return;
    if (!reset && feedRef.current.ready && !feedRef.current.nextCursor) return;
    request.current?.abort();
    if (reset) seenCursors.current.clear();
    const controller = new AbortController(), epoch = ++generation.current,cacheVersion=recommendationCacheVersion(accountId);
    request.current = controller;
    const previous = feedRef.current;
    const starting = { ...previous, busy: true, error: null, refreshRequired: false };
    feedRef.current = starting; setFeed(starting);
    const params = new URLSearchParams({ surface, mode, limit: String(PAGE_SIZE) });
    if (!reset && previous.nextCursor) params.set("cursor", previous.nextCursor);
    try {
      if(browserOffline())throw new UserFacingError({kind:"offline",title:previous.ready?"Your saved selection is ready.":"This selection has not been saved yet.",message:previous.ready?"Reconnect to discover more songs. Your saved recommendations are still here.":"Open this page while connected to keep its recommendations available offline.",action:"Try again"});
      const raw = await recommendationJson(accountId, "/api/v2/feed?" + params,
        controller.signal, { identity: cacheKey, force: reset, acceptStatuses: [409, 410] });
      if (controller.signal.aborted || epoch !== generation.current) return;
      if (!Array.isArray(raw.items) && typeof raw.error === "string") {
        const changed = { ...previous, busy: false, refreshRequired: true, error: null };
        feedRef.current = changed; setFeed(changed); return;
      }
      const page = parseFeed(raw);
      const unique = appendUniqueFeedItems(reset ? [] : previous.items, page.items);
      const next: FeedState = { ...page, items: unique,
        sections: reset || !previous.ready ? page.sections : previous.sections,
        ready: true, busy: false, error: null, refreshRequired: false };
      // A repeated cursor cannot keep an observer making the same request.
      if (!reset && previous.nextCursor) seenCursors.current.add(previous.nextCursor);
      if (page.nextCursor && seenCursors.current.has(page.nextCursor)) next.nextCursor = null;
      if(recommendationCacheVersion(accountId)!==cacheVersion)return;
      feedRef.current = next; setFeed(next); saveFeed(accountId,cacheKey, next,cacheVersion);
    } catch (error) {
      if (controller.signal.aborted || epoch !== generation.current) return;
      const failed = { ...previous, busy: false, error };
      feedRef.current = failed; setFeed(failed);
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [accountId, cacheKey, mode, surface]);

  useEffect(() => {
    let active=true;
    void (async()=>{
      if(feedRef.current.ready)return;
      const saved=await readRecommendationCache<FeedState>(accountId,"feed:"+cacheKey);
      if(!active)return;
      if(saved&&saved.data.ready&&Array.isArray(saved.data.items)&&Array.isArray(saved.data.sections)){
        const restored={...saved.data,busy:false,error:null,refreshRequired:false};feedRef.current=restored;setFeed(restored);
        if(browserOffline()||Date.now()-saved.savedAt<CACHE_LIFETIME)return;
      }
      await load(!!saved);
    })();
    const online=()=>{if(!feedRef.current.ready||feedRef.current.error)void load(true);};window.addEventListener("online",online);
    return () => {active=false;request.current?.abort();request.current=null;window.removeEventListener("online",online);};
  }, [load,accountId,cacheKey]);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !feed.ready || !feed.nextCursor || feed.error || feed.refreshRequired||music.offline) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void load();
    }, { root: root.current?.closest("#music-main") || null, rootMargin: "420px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [feed.ready, feed.nextCursor, feed.error, feed.refreshRequired, load,music.offline]);
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ accountId?: string }>).detail;
      if (detail?.accountId && detail.accountId !== accountId) return;
      clearAccountFeeds(accountId,event.type!=="sakura-recommendations-cleared");
      // Erasure takes effect even if the replacement request fails offline.
      // No card carrying a removed listening explanation remains cached or visible.
      if (event.type === "sakura-personalization-cleared" || event.type === "sakura-listening-erased"||event.type==="sakura-recommendations-cleared") {
        const cleared = emptyFeed(); feedRef.current = cleared; setFeed(cleared);
      }
      void load(true);
    };
    window.addEventListener("sakura-taste-updated", changed);
    window.addEventListener("sakura-personalization-cleared", changed);
    window.addEventListener("sakura-listening-erased", changed);
    window.addEventListener("sakura-recommendations-cleared",changed);
    return () => {
      window.removeEventListener("sakura-taste-updated", changed);
      window.removeEventListener("sakura-personalization-cleared", changed);
      window.removeEventListener("sakura-listening-erased", changed);
      window.removeEventListener("sakura-recommendations-cleared",changed);
    };
  }, [accountId, load]);

  const pick = hero.ready ? hero.item : feed.items[0];
  useEffect(()=>{heroPickRef.current=pick||null;},[pick]);
  const pickTrack = pick?.track;
  const allTracks = useMemo(() => [...new Map([...(pickTrack ? [pickTrack] : []), ...feed.items.map(item => item.track)].map(track => [track.id, track])).values()], [pickTrack, feed.items]);
  // The hero changes independently; cards below it keep their place while scrolling.
  const chapters = useMemo(() => {
    const groups: FeedItem[][] = [];
    for (let i = 0; i < feed.items.length; i += CHAPTER_SIZE) groups.push(feed.items.slice(i, i + CHAPTER_SIZE));
    return groups;
  }, [feed.items]);
  const motionRegions = useMemo(() => [chapters, feed.sections], [chapters, feed.sections]);
  useVisibleMotion(root, motionRegions);
  const discovery = mode === "familiar" ? 0 : mode === "explore" ? 1 : music.settings.discovery;
  const discoveryLabel = discovery <= .25 ? "More familiar music" : discovery >= .7 ? "More new music" : "Familiar songs and new discoveries";
  const openMenu = useCallback((track: MusicTrack, anchor: SongMenuAnchor) => setMenu({ track, anchor }), []);
  const privateListening = music.settings.privateSession || music.settings.learnFromListening === false;
  const source = useMemo<FeedSource>(() => ({ context: home ? "home-feed" : "discover-feed" }), [home]);

  return <div ref={root} className={s.feedRoom} data-surface={surface} data-personalized-feed={surface}>
    <div className={s.welcome}><span><Blossom/>{home ? `Music for ${music.account?.username || "you"}` : "ROOM FOR NEW MUSIC"}</span>
      <Link href="/settings#your-feed"><Icon name="settings" size={14}/>Tune your feed</Link></div>

    <section className={s.hero} aria-label={home ? "Your soundtrack" : "Your discovery"}>
      <div className={s.heroCopy}><span className={s.handwritten}>{home ? "a quiet place for your music." : "room for something new."}</span>
        <h1>{home ? <>Let the world<br/><em>wait a little.</em></> : <>A world of<br/><em>good sound.</em></>}</h1>
        <p>{home ? "Your favorites, a few new discoveries, and a quiet place to listen."
          : "New artists, familiar voices, and songs worth discovering. Explore at your own pace."}</p>
        <div className={s.heroActions}><SmartQueueButton scope="all" secondary={false}
          label={home ? "Find my soundtrack" : "Find my soundtrack"}/>
          <Link href={home ? "/discover" : "/liked"}>{home ? "Explore new music" : "Your liked songs"}<Icon name="arrow" size={15}/></Link></div>
        <div className={s.tasteNote}><span className={s.tasteDot}/>{discoveryLabel}
          <button type="button" onClick={() => setShowWhy(value => !value)} aria-expanded={showWhy} aria-controls={explanationId}>About recommendations</button></div>
      </div>
      <div className={s.heroMusic} data-hero-music data-motion-region><HeroGarden surface={surface}/>
        {pick ? <HeroPick item={pick} tracks={allTracks} source={source} onOptions={openMenu}/> : <div className={s.waitingSleeve} aria-hidden="true"><Blossom/><span>your next<br/><em>good song</em></span><i/></div>}
        <span className={s.cornerNote}>{home ? "music, with room to breathe" : "another side of music"}</span>
      </div>
    </section>

    {showWhy && <div id={explanationId} data-feed-explanation className={s.explanation}><Blossom/><div><h2>How these songs are selected.</h2>
      <p>{feed.personalized ? "Your likes and chosen artists and genres guide these songs. When learning is on, saved listening also helps refine the selection. A skip alone is not a dislike."
        : "Your chosen artists and genres provide a starting point. When learning is enabled, listening history helps refine the selection. You can change your preferences in Settings."}</p>
      <p>Each song includes a recommendation reason. Song options let you reduce its influence or exclude it for a chosen period.</p>
      <Link href="/profile">See your listening journal<Icon name="arrow" size={14}/></Link></div>
      <button type="button" aria-label="Close feed explanation" onClick={() => setShowWhy(false)}><Icon name="close" size={17}/></button></div>}

    <nav className={s.littlePaths} aria-label="Your music paths">
      <Link href="/liked"><span className={s.pathIcon}><Icon name="heart"/></span><span><b>The songs you keep</b><small>Your saved favorites</small></span><Icon name="arrow" size={15}/></Link>
      <Link href="/library/downloaded"><span className={s.pathIcon}><Icon name="download"/></span><span><b>Music to take with you</b><small>Downloaded on this device</small></span><Icon name="arrow" size={15}/></Link>
      <Link href="/profile"><span className={s.pathIcon}><Blossom/></span><span><b>Your listening journal</b><small>Your listening, over time</small></span><Icon name="arrow" size={15}/></Link>
    </nav>

    {privateListening && <div className={s.privateNote}><Icon name="moon" size={16}/><p>{music.settings.privateSession
      ? "Private listening is on. New listening activity is not saved."
      : "Learning is paused. New listening activity is not saved."}</p><Link href="/settings#your-feed">Your controls<Icon name="arrow" size={14}/></Link></div>}

    {children}

    {feed.sections.slice(0, 3).map((section, index) => <section key={section.id} className={s.spotlight} aria-label={section.title} data-motion-region>
      <div className={s.sectionHeading}><div><span className={s.eyebrow}>{index === 0 ? "FROM YOUR LISTENING" : "MORE TO EXPLORE"}</span><h2>{section.title}</h2><p>{section.description}</p></div>
        <SmartQueueButton scope="collection" tracks={section.tracks} label="Play a mix"/></div>
      <div className={s.shelf} tabIndex={0} aria-label={section.title + " songs; scroll for more"}>{section.tracks.slice(0, 8).map((track, position) => <ShelfSong key={track.id} track={track}
        tracks={section.tracks} position={position} source={{ ...source, contextId: section.id }} onOptions={openMenu}/>)}</div>
    </section>)}

    <section className={s.continuous} aria-label={home ? "Your personalized song feed" : "Your discovery song feed"}>
      <div className={s.feedHeading}><div><span className={s.eyebrow}>{home ? "SELECTED FOR YOUR LISTENING" : "MORE MUSIC TO DISCOVER"}</span><h2>{home ? "Your next song." : "Something new to hear."}</h2><p>{home ? "Familiar songs and new discoveries, in the balance you choose."
        : "Explore new songs and artists alongside familiar favorites."}</p></div>
        <button type="button" className={s.refresh} title="Refresh this song selection" aria-label={feed.busy && feed.ready ? "Refreshing songs…" : "Refresh selection"} disabled={feed.busy} onClick={() => void load(true)}><Icon name="motion" size={16}/>{feed.busy && feed.ready ? "Refreshing songs…" : "Refresh selection"}</button></div>
      <div className={s.feedControls}><div className={s.modeChoices} role="group" aria-label="Feed direction">
        {([["balanced", "For you", "Blends familiar songs and discoveries using your feed settings."], ["familiar", "Familiar", "Give familiar songs and artists more priority."], ["explore", "Explore", "Give unheard songs and new artists more priority."]] as const).map(([value, label, title]) =>
          <button key={value} type="button" aria-pressed={mode === value} title={title} onClick={() => onMode(value)}>{value === "balanced" ? <Blossom/> : <Icon name={value === "familiar" ? "heart" : "discover"} size={14}/>} {label}</button>)}</div>
        <Link href="/settings#your-feed"><Icon name="settings" size={14}/>Fine-tune</Link></div>

      {!feed.ready && feed.busy && <FeedSkeleton/>}
      <span className={s.srOnly} aria-live="polite" aria-atomic="true">{feed.ready && !feed.busy ? `${feed.items.length} songs in your feed.` : ""}</span>
      {!!feed.error && !feed.ready && <RecoveryNotice error={feed.error} retry={() => void load(true)}/>}
      {feed.ready && !feed.items.length && <div className={s.emptyGarden}><Blossom/><h3>No recommendations yet.</h3><p>Choose favorite artists or explore the catalog to start your recommendations.</p>
        <div><Link href="/onboarding">Choose favorite artists<Icon name="arrow" size={15}/></Link><Link href="/search">Search music<Icon name="search" size={15}/></Link></div></div>}

      <div className={s.songChapters}>{chapters.map((chapter, chapterIndex) => <div key={chapter[0].track.id} className={s.chapter} data-motion-region>
        {chapterIndex > 0 && <div className={s.chapterDivider} aria-hidden="true"><span/><Blossom/><span/><i>more music to explore</i></div>}
        <div className={s.songGrid}>{chapter.map((item, index) => <FeedSong key={item.track.id} item={item} tracks={allTracks}
          number={chapterIndex * CHAPTER_SIZE + index + 2} featured={index === 0} source={source} onOptions={openMenu}/>)}</div>
      </div>)}</div>

      <div ref={sentinel} className={s.moreSongs}>
        {feed.refreshRequired ? <div className={s.changedFeed}><Blossom/><h3>This selection needs a refresh.</h3><p>Your preferences changed or this selection expired. Refresh it to see current recommendations.</p><Button secondary icon="motion" onClick={() => void load(true)}>Refresh your feed</Button></div>
          : feed.error && feed.ready ? <RecoveryNotice error={feed.error} retry={() => void load()}/>
          : feed.ready && feed.nextCursor ? <><span className={s.loadingStem} aria-hidden="true"><i/><Blossom/><i/></span><p role="status">{feed.busy ? "Loading more songs…" : "More songs are available."}</p>
            <Button secondary icon="plus" disabled={feed.busy} onClick={() => void load()}>{feed.busy ? "Loading more songs…" : "Load more songs"}</Button></>
          : feed.ready && feed.items.length > 0 ? <><Blossom/><h3>You&apos;ve reached the end of this selection.</h3><p>Refresh the selection, adjust your preferences, or explore an artist.</p><Button secondary icon="motion" disabled={feed.busy} onClick={() => void load(true)}>Refresh selection</Button></> : null}
      </div>
    </section>

    <div className={s.bloomPath}><Link href={home ? "/discover" : "/search"}><Icon name="map"/><span><b>{home ? "More music to discover." : "Explore artists and albums."}</b><small>{home ? "Browse new songs and familiar artists in Discover." : "Explore an artist, an album, or the song on your mind."}</small></span><Icon name="arrow" size={16}/></Link>
      <Link href="/bloom"><Blossom/><span><b>Your listening, in Bloom.</b><small>Open your listening stories in Sakura Bloom.</small></span><Icon name="arrow" size={16}/></Link></div>
    {menu && <TrackMenu track={menu.track} anchor={menu.anchor} onClose={() => setMenu(null)}/>}
  </div>;
}

function songState(music: ReturnType<typeof useMusic>, track: MusicTrack) {
  const id = music.effectiveId(track), current = !!music.track && music.effectiveId(music.track) === id;
  return { id, current, playing: current && music.status === "playing",
    engaged: current && ["playing", "buffering", "resolving"].includes(music.status) };
}
function SongPlay({ track, tracks, className, source }: { track: MusicTrack; tracks: MusicTrack[]; className: string; source: FeedSource }) {
  const music = useMusic(), state = songState(music, track);
  return <button type="button" className={className} aria-label={(state.engaged ? "Pause " : "Play ") + track.title}
    onClick={() => state.engaged ? music.togglePlay() : music.play(track, tracks, source)}><Icon name={state.engaged ? "pause" : "play"} size={18}/></button>;
}
function SongTools({ track, onOptions }: { track: MusicTrack; onOptions: (track: MusicTrack, anchor: SongMenuAnchor) => void }) {
  const music = useMusic(), { id } = songState(music, track), liked = music.liked.has(id);
  return <div className={s.songTools}><button type="button" aria-label={(liked ? "Unlike " : "Like ") + track.title} aria-pressed={liked}
    onClick={() => void music.toggleLike(track)}><Icon name="heart" size={17}/></button>
    <button type="button" aria-label={"More options for " + track.title} aria-haspopup="menu" onClick={event => {
      const { left, top, width, height } = event.currentTarget.getBoundingClientRect(); onOptions(track, { left, top, width, height });
    }}><Icon name="more" size={19}/></button></div>;
}
function HeroPick({ item, tracks, source, onOptions }: { item: FeedItem; tracks: MusicTrack[]; source: FeedSource; onOptions: (track: MusicTrack, anchor: SongMenuAnchor) => void }) {
  const music = useMusic(), state = songState(music, item.track);
  return <SongGesture id={state.id} className={s.heroPick} onOptions={anchor => onOptions(item.track, anchor)}>
    <span className={s.pickLabel}>A SONG FROM YOUR SELECTION</span>
    <div className={s.sleeveArt}><div className={s.record} data-playing={state.playing || undefined} aria-hidden="true"><i/><b/></div>
      <Artwork url={item.track.coverUrl} title={item.track.albumTitle || item.track.title}/><span className={s.sleeveSeal} aria-hidden="true"><Blossom/></span>
      <SongPlay track={item.track} tracks={tracks} source={source} className={s.sleevePlay}/></div>
    <div className={s.pickCaption}><div><Link href={"/track/" + encodeURIComponent(state.id)} dir="auto">{item.track.title}</Link><ArtistLinks track={item.track}/></div><SongTools track={item.track} onOptions={onOptions}/></div>
    <p className={s.pickReason}>{item.reason}</p>
  </SongGesture>;
}
function ShelfSong({ track, tracks, position, source, onOptions }: { track: MusicTrack; tracks: MusicTrack[]; position: number; source: FeedSource; onOptions: (track: MusicTrack, anchor: SongMenuAnchor) => void }) {
  const music = useMusic(), state = songState(music, track);
  return <SongGesture id={state.id} className={s.shelfSong} onOptions={anchor => onOptions(track, anchor)}>
    <div className={s.shelfArtwork}><Artwork url={track.coverUrl} title={track.albumTitle || track.title}/><span aria-hidden="true">{String(position + 1).padStart(2, "0")}</span><SongPlay track={track} tracks={tracks} source={source} className={s.shelfPlay}/></div>
    <Link className={s.shelfTitle} href={"/track/" + encodeURIComponent(state.id)} dir="auto">{track.title}</Link><ArtistLinks track={track} className={s.shelfArtist}/>
    <div className={s.shelfBottom}><span>{time(track.durationMs)}</span><SongTools track={track} onOptions={onOptions}/></div>
  </SongGesture>;
}
function FeedSong({ item, tracks, number, featured, source, onOptions }: {
  item: FeedItem; tracks: MusicTrack[]; number: number; featured: boolean; source: FeedSource; onOptions: (track: MusicTrack, anchor: SongMenuAnchor) => void;
}) {
  const music = useMusic(), track = item.track, state = songState(music, track), lane = lanes[item.lane];
  return <SongGesture id={state.id} className={`${s.song} ${featured ? s.featuredSong : ""} ${state.current ? s.currentSong : ""}`}
    onOptions={anchor => onOptions(track, anchor)}>
    <div className={s.songArtwork}><Artwork url={track.coverUrl} title={track.albumTitle || track.title}/><span className={s.songNumber} aria-hidden="true">{String(number).padStart(2, "0")}</span>
      <SongPlay track={track} tracks={tracks} source={source} className={s.songPlay}/>{state.playing && <span className={s.playingPetals} aria-label="Now playing"><i/><i/><i/></span>}</div>
    <div className={s.songBody}><span className={`${s.lane} ${!featured && item.lane !== "fresh" ? s.srOnly : ""}`} data-lane={item.lane}><Icon name={lane.icon} size={12}/>{lane.label}</span>
      <Link className={s.songTitle} href={"/track/" + encodeURIComponent(state.id)} dir="auto">{track.title}</Link><ArtistLinks track={track} className={s.songArtist}/>
      <p className={s.songReason}>{item.reason}</p><div className={s.songBottom}><span className={s.songDetails}>{track.genres?.[0] && <span>{track.genres[0]}</span>}<span>{time(track.durationMs)}</span>
        {track.versionLabel !== "Original recording" && <span title={track.versionLabel}>{track.versionLabel}</span>}</span><SongTools track={track} onOptions={onOptions}/></div></div>
  </SongGesture>;
}
function FeedSkeleton() {
  return <div className={s.skeleton} role="status" aria-label="Finding songs for your feed"><span className={s.srOnly}>Finding songs for your feed</span>{[0,1,2,3,4,5].map(value => <div key={value}><i/><b/><span/><span/></div>)}</div>;
}
