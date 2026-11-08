import { normalizeMetadataText } from "../core/identity";
import type { ArtistCredit, ProviderReference } from "../core/types";
import type { CatalogRecording } from "./contracts";
import { readMetadataJson } from "./providers";

const USER_AGENT = "Sakura/2.0 (https://github.com/billighost/sakura)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicRequests = { pending: Promise.resolve(), lastRequest: 0 };
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null;
}
function artistUrl(reference?: ProviderReference): string | null {
  if (!reference || reference.scope) return null;
  if (reference.provider === "spotify" && /^[A-Za-z0-9]{22}$/.test(reference.id)) return `https://open.spotify.com/artist/${reference.id}`;
  if (reference.provider === "deezer" && /^[1-9]\d{0,17}$/.test(reference.id)) return `https://www.deezer.com/artist/${reference.id}`;
  return null;
}
function names(value: ObjectValue): readonly string[] {
  const aliases = Array.isArray(value.aliases) ? value.aliases : [];
  const published = [value.name, ...aliases.filter(raw => {
    const alias = object(raw);
    return alias?.primary === true && alias.ended !== true && alias.type === "Artist name";
  }).map(raw => object(raw)?.name)];
  return [...new Set(published.filter((name): name is string => typeof name === "string" && name.trim().length > 0 && name.length <= 200))].slice(0, 8);
}
async function waitForRequest(previous: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const aborted = () => { signal.removeEventListener("abort", aborted); reject(signal.reason); };
    signal.addEventListener("abort", aborted, { once: true });
    previous.then(() => { signal.removeEventListener("abort", aborted); resolve(); }, error => { signal.removeEventListener("abort", aborted); reject(error); });
  });
  signal.throwIfAborted();
}

/** Artist identities are separate from recording identities. Exact, reciprocal
 * catalogue URLs authorize published primary names; a search hit or romanized
 * guess cannot change a credit. These IDs never become recording references. */
export class CatalogArtistAliases {
  private cached = new Map<string, { names: readonly string[]; until: number }>();
  private readonly requests: typeof publicRequests;
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly intervalMs = 1100) {
    this.requests = intervalMs > 0 ? publicRequests : { pending: Promise.resolve(), lastRequest: 0 };
  }

  private async json(url: string, signal: AbortSignal): Promise<ObjectValue | null> {
    // MusicBrainz's public metadata service permits one request per second.
    const previous = this.requests.pending;
    let release!: () => void;
    const finished = new Promise<void>(resolve => { release = resolve; });
    // Canceling a queued request releases its caller promptly while the queue's
    // tail still waits for every preceding request to finish.
    this.requests.pending = previous.then(() => finished);
    try {
      await waitForRequest(previous, signal);
      signal.throwIfAborted();
      const delay = this.requests.lastRequest + this.intervalMs - Date.now();
      if (delay > 0) await new Promise<void>((resolve, reject) => {
        const aborted = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, delay);
        signal.addEventListener("abort", aborted, { once: true });
      });
      signal.throwIfAborted();
      this.requests.lastRequest = Date.now();
      const response = await this.fetcher(url, { signal, redirect: "error", headers: { "User-Agent": USER_AGENT } });
      if (signal.aborted) { await response.body?.cancel(); signal.throwIfAborted(); }
      if (!response.ok || response.redirected || (response.url && new URL(response.url).origin !== "https://musicbrainz.org")) { await response.body?.cancel(); return null; }
      const payload = object(await readMetadataJson(response));
      signal.throwIfAborted();
      return payload;
    } finally { release(); }
  }

  async forCredit(credit: ArtistCredit, signal: AbortSignal): Promise<readonly string[]> {
    signal.throwIfAborted();
    const resource = artistUrl(credit.reference);
    if (!resource) return [credit.name];
    signal.throwIfAborted();
    let published = this.cached.get(resource);
    if (!published || published.until <= Date.now()) {
      const linked = await this.json(`https://musicbrainz.org/ws/2/url?${new URLSearchParams({ resource, inc: "artist-rels", fmt: "json" })}`, signal);
      // An incorrect resource or several artist identities is not usable proof.
      if (linked?.resource !== resource || !Array.isArray(linked.relations)) return [credit.name];
      const related = linked.relations.filter(raw => {
        const relation = object(raw);
        return relation?.["target-type"] === "artist" && relation.ended !== true;
      }).map(raw => object(object(raw)?.artist)?.id);
      if (related.some(id => typeof id !== "string" || !UUID.test(id))) return [credit.name];
      const ids = [...new Set(related as string[])];
      if (ids.length !== 1) return [credit.name];
      const artist = await this.json(`https://musicbrainz.org/ws/2/artist/${ids[0]}?inc=aliases+url-rels&fmt=json`, signal);
      if (artist?.id !== ids[0] || !Array.isArray(artist.relations) || !artist.relations.some(raw => {
        const relation = object(raw);
        return relation?.["target-type"] === "url" && relation.ended !== true && object(relation.url)?.resource === resource;
      })) return [credit.name];
      const verified = names(artist);
      if (!verified.length) return [credit.name];
      signal.throwIfAborted();
      if (this.cached.size >= 500) this.cached.delete(this.cached.keys().next().value!);
      published = { names: verified, until: Date.now() + 24 * 60 * 60000 };
      this.cached.set(resource, published);
    }
    signal.throwIfAborted();
    if (!published.names.some(name => normalizeMetadataText(name) === normalizeMetadataText(credit.name))) return [credit.name];
    return [...new Set([credit.name, ...published.names])].slice(0, 8);
  }

  async variants(row: CatalogRecording, signal: AbortSignal): Promise<readonly CatalogRecording[]> {
    signal.throwIfAborted();
    const credits = row.artistCredits;
    if (row.metadata.artistsComplete !== true || !credits || credits.length !== row.metadata.artists.length || credits.length > 8 || credits.some((credit, index) =>
      normalizeMetadataText(credit.name) !== normalizeMetadataText(row.metadata.artists[index]) || credit.role !== (index === 0 ? "primary" : "featured"))) return [];
    const alternatives: (readonly string[])[] = [];
    for (const credit of credits) {
      try { alternatives.push(await this.forCredit(credit, signal)); }
      catch { signal.throwIfAborted(); alternatives.push([credit.name]); }
    }
    let combinations: readonly string[][] = [[]];
    for (const alternativesForCredit of alternatives) combinations = combinations.flatMap(prefix => alternativesForCredit.map(name => [...prefix, name])).slice(0, 16);
    signal.throwIfAborted();
    return combinations.filter(artists => artists.some((name, index) => name !== row.metadata.artists[index])).map(artists => ({
      ...row, metadata: { ...row.metadata, artists }, artistCredits: credits.map((credit, index) => ({ ...credit, name: artists[index] })),
    }));
  }
}
