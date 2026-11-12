import { requestJson, type JsonOptions } from "./errors";
import { SharedFlight } from "./sharedFlight";
import { canonicalResourcePath } from "./resourcePolicy";
import { recommendationCacheVersion } from "./recommendationCache";

const flights = new SharedFlight<Record<string, unknown>>();
const completed = new Map<string, { data: Record<string, unknown>; savedAt: number }>();
/** Intent prefetch and mounted views share one account/version-scoped request. */
export async function recommendationJson(accountId: string, path: string, signal: AbortSignal, options: Pick<JsonOptions, "acceptStatuses"> & { force?: boolean; identity?: string } = {}) {
 signal.throwIfAborted();
 const version = recommendationCacheVersion(accountId), key = JSON.stringify([accountId, canonicalResourcePath(path), version, options.identity || ""]);
 const saved = completed.get(key);
 // This brief handoff window covers a view mounting just after prefetch finishes.
 if (!options.force && saved && Date.now() - saved.savedAt < 5000) return saved.data;
 if (options.force) completed.delete(key);
 return flights.run(key, signal, async sharedSignal => {
  const data = await requestJson<Record<string, unknown>>(path, { signal: sharedSignal }, { accountId, context: "page", acceptStatuses: options.acceptStatuses });
  sharedSignal.throwIfAborted();
  if (recommendationCacheVersion(accountId) !== version) throw new DOMException("Recommendations changed", "AbortError");
  // Cursor expiry and conflict responses are authoritative, but never cache them.
  if (typeof data.error !== "string") {
   completed.delete(key); completed.set(key, { data, savedAt: Date.now() });
   while (completed.size > 24) completed.delete(completed.keys().next().value!);
  }
  return data;
 });
}
