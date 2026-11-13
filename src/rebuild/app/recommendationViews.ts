import { musicTrack, type MusicTrack } from "./types";
import { recommendationJson } from "./recommendationTransport";
import { browserOffline } from "./resourcePolicy";
import { HERO_REFRESH_MS } from "../recommendations/hero";
import { clearRecommendationCache, readRecommendationCache, recommendationCacheValid, recommendationCacheVersion, writeRecommendationCache } from "./recommendationCache";

export type RecommendationSurface = "home" | "discover";
export type RecommendationMode = "balanced" | "familiar" | "explore";
export type RecommendationLane = "familiar" | "similar" | "explore" | "fresh";
export interface FeedItem { track: MusicTrack; reason: string; lane: RecommendationLane }
export interface FeedSection { id: string; title: string; description: string; tracks: MusicTrack[] }
export interface FeedState {
  items: FeedItem[]; sections: FeedSection[]; nextCursor: string | null; ready: boolean;
  busy: boolean; error: unknown; refreshRequired: boolean; personalized: boolean;
  totalCandidates: number; generatedAt: string;
}
export type HeroRecommendation = FeedItem;
export interface HeroState { item: HeroRecommendation | null; ready: boolean; refreshAt: number; generatedAt?: number }
interface CachedView<T> { state: T; savedAt: number }
// Preserve complete visited pages and the independently rotating hero in the
// existing device caches. Neither collection can grow across unlimited tastes.
const visitedFeeds = new Map<string, CachedView<FeedState>>();
const visitedHeroes = new Map<string, CachedView<HeroState>>();
const invalidatedEvents = new WeakMap<Event, Set<string>>();
export const FEED_CACHE_LIFETIME = 20 * 60 * 1000;
export const FEED_PAGE_SIZE = 12;

function retain<T>(cache: Map<string, CachedView<T>>, key: string, saved: CachedView<T>) {
  cache.delete(key); cache.set(key, saved);
  while (cache.size > 8) cache.delete(cache.keys().next().value!);
}
export function emptyFeed(): FeedState {
  return { items: [], sections: [], nextCursor: null, ready: false, busy: true, error: null,
    refreshRequired: false, personalized: false, totalCandidates: 0, generatedAt: "" };
}
export function emptyHero(): HeroState { return { item: null, ready: false, refreshAt: 0 }; }
export function freshFeed(saved: CachedView<FeedState> | undefined) {
  return !!saved && (browserOffline() || Date.now() - saved.savedAt < FEED_CACHE_LIFETIME);
}
export function cachedFeed(accountId: string, key: string): FeedState {
  const saved = visitedFeeds.get(key);
  return saved && recommendationCacheValid(accountId, saved.savedAt) && freshFeed(saved)
    ? { ...saved.state, busy: false, error: null, refreshRequired: false } : emptyFeed();
}
export function cachedHero(accountId: string, key: string): HeroState {
  const saved = visitedHeroes.get(key);
  return saved && recommendationCacheValid(accountId, saved.savedAt) ? saved.state : emptyHero();
}
export function saveFeed(accountId: string, key: string, state: FeedState, version: number) {
  if (recommendationCacheVersion(accountId) !== version || visitedFeeds.get(key)?.state === state) return;
  retain(visitedFeeds, key, { state, savedAt: Math.max(Date.now(), version + 1) });
  void writeRecommendationCache(accountId, "feed:" + key, state, version);
}
function saveHero(accountId: string, key: string, state: HeroState, version: number) {
  if (recommendationCacheVersion(accountId) !== version) return;
  const current = visitedHeroes.get(key);
  // A slow first-page prefetch must not roll back a newer independent rotation.
  if (current && recommendationCacheValid(accountId, current.savedAt) &&
    (current.state.generatedAt || 0) > (state.generatedAt || 0)) return current.state;
  if (current?.state === state) return state;
  retain(visitedHeroes, key, { state, savedAt: Math.max(Date.now(), version + 1) });
  void writeRecommendationCache(accountId, "hero:" + key, state, version);
  return state;
}
export async function restoreFeed(accountId: string, key: string, signal?: AbortSignal): Promise<CachedView<FeedState> | undefined> {
  signal?.throwIfAborted();
  const version = recommendationCacheVersion(accountId), present = visitedFeeds.get(key);
  if (present && recommendationCacheValid(accountId, present.savedAt)) return present;
  const saved = await readRecommendationCache<FeedState>(accountId, "feed:" + key);
  signal?.throwIfAborted();
  if (recommendationCacheVersion(accountId) !== version || !saved?.data.ready ||
    !Array.isArray(saved.data.items) || !Array.isArray(saved.data.sections)) return;
  const current = visitedFeeds.get(key);
  if (current && current.savedAt > saved.savedAt) return current;
  const restored = { state: { ...saved.data, busy: false, error: null, refreshRequired: false }, savedAt: saved.savedAt };
  retain(visitedFeeds, key, restored); return restored;
}
export async function restoreHero(accountId: string, key: string, signal?: AbortSignal): Promise<HeroState> {
  signal?.throwIfAborted();
  const version = recommendationCacheVersion(accountId), present = cachedHero(accountId, key);
  if (present.ready) return present;
  const saved = await readRecommendationCache<HeroState>(accountId, "hero:" + key);
  signal?.throwIfAborted();
  if (recommendationCacheVersion(accountId) !== version || !saved?.data.ready ||
    !(saved.data.item === null || saved.data.item?.track)) return emptyHero();
  const current = visitedHeroes.get(key);
  if (current && current.savedAt > saved.savedAt) return current.state;
  retain(visitedHeroes, key, { state: saved.data, savedAt: saved.savedAt }); return saved.data;
}
/** Feed and hero listeners share one privacy fence for the same dispatched event. */
export function invalidateRecommendationViews(accountId: string, event: Event) {
  const accounts = invalidatedEvents.get(event) || new Set<string>();
  if (accounts.has(accountId)) return;
  accounts.add(accountId); invalidatedEvents.set(event, accounts);
  if (event.type !== "sakura-recommendations-cleared") clearRecommendationCache(accountId);
  for (const key of visitedFeeds.keys()) if (key.startsWith(accountId + ":")) visitedFeeds.delete(key);
  for (const key of visitedHeroes.keys()) if (key.startsWith(accountId + ":")) visitedHeroes.delete(key);
}
function asTrack(value: unknown): MusicTrack | null {
  try { return value && typeof value === "object" ? musicTrack(value as Record<string, unknown>) : null; }
  catch { return null; }
}
export function parseFeed(raw: Record<string, unknown>): FeedState {
  if (!Array.isArray(raw.items)) throw new Error("Feed response unavailable");
  const items = raw.items.flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>, track = asTrack(item.track);
    if (!track) return [];
    const lane = ["familiar", "similar", "explore", "fresh"].includes(String(item.lane)) ? item.lane as RecommendationLane : "similar";
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
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "", ready: true, busy: false, error: null, refreshRequired: false };
}
function parseHero(raw: Record<string, unknown>): HeroState {
  if (raw.item !== null && (!raw.item || typeof raw.item !== "object")) throw new Error("Hero response unavailable");
  const value = raw.item as Record<string, unknown> | null, track = value ? asTrack(value.track) : null;
  if (value && !track) throw new Error("Hero response unavailable");
  const item = value && track ? { track, reason: typeof value.reason === "string" ? value.reason : "Selected for your recommendations.",
    lane: (["familiar", "similar", "explore", "fresh"].includes(String(value.lane)) ? value.lane : "similar") as RecommendationLane } : null;
  const now = Date.now(), at = Number(raw.refreshAt), generatedAt = typeof raw.generatedAt === "string" ? Date.parse(raw.generatedAt) : NaN;
  return { item, ready: true, refreshAt: Number.isFinite(at) ? Math.max(now + 1000, Math.min(now + HERO_REFRESH_MS, at)) : now + HERO_REFRESH_MS,
    ...(Number.isFinite(generatedAt) ? { generatedAt } : {}) };
}
/** Both mounted views and either prefetch lease use exactly this initial path. */
export async function loadFirstFeed(accountId: string, key: string, surface: RecommendationSurface, mode: RecommendationMode, signal: AbortSignal, force = false) {
  signal.throwIfAborted();
  const version = recommendationCacheVersion(accountId);
  const params = new URLSearchParams({ surface, mode, limit: String(FEED_PAGE_SIZE), includeHero: "1" });
  const raw = await recommendationJson(accountId, "/api/v2/feed?" + params, signal, { identity: key, force, acceptStatuses: [409, 410] });
  signal.throwIfAborted();
  if (recommendationCacheVersion(accountId) !== version) throw new DOMException("Recommendations changed", "AbortError");
  let feed: FeedState | undefined, hero: HeroState | undefined;
  if (Array.isArray(raw.items) && typeof raw.error !== "string") {
    feed = parseFeed(raw); saveFeed(accountId, key, feed, version);
    if (raw.hero && typeof raw.hero === "object") {
      // Optional malformed/legacy hero data cannot block otherwise usable cards.
      try { hero = saveHero(accountId, key, parseHero(raw.hero as Record<string, unknown>), version); } catch {}
    }
  }
  return { raw, feed, hero };
}
/** Subsequent rotations remain independent of the saved feed's page ordering. */
export async function loadHero(accountId: string, key: string, surface: RecommendationSurface, mode: RecommendationMode, signal: AbortSignal, force = false) {
  signal.throwIfAborted();
  const version = recommendationCacheVersion(accountId);
  const raw = await recommendationJson(accountId, "/api/v2/feed/hero?" + new URLSearchParams({ surface, mode }), signal, { identity: key, force });
  signal.throwIfAborted();
  if (recommendationCacheVersion(accountId) !== version) throw new DOMException("Recommendations changed", "AbortError");
  return saveHero(accountId, key, parseHero(raw), version)!;
}
export async function loadInitialHero(accountId: string, key: string, surface: RecommendationSurface, mode: RecommendationMode, signal: AbortSignal, force = false) {
  const saved = force ? undefined : await restoreFeed(accountId, key, signal);
  if (!freshFeed(saved)) {
    const first = await loadFirstFeed(accountId, key, surface, mode, signal, force);
    if (first.hero) return first.hero;
  }
  // Warm feeds may predate the combined envelope. Restore/rotate their hero
  // without recreating the feed session; old fixture responses also land here.
  const hero = cachedHero(accountId, key);
  if (!force && hero.ready && hero.refreshAt > Date.now()) return hero;
  return loadHero(accountId, key, surface, mode, signal, force);
}
