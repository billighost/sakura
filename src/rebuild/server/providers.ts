import { fetchAudioHeaders } from "../core/streaming";
import { referenceKey, parseRecordingTitle } from "../core/identity";
import { parseRecordingMetadata } from "./input";
import { ProviderError } from "./contracts";
import type { CatalogProvider, CatalogRecording } from "./contracts";
import type { ProviderReference,ArtistCredit } from "../core/types";

const USER_AGENT = "Sakura/2.0 (https://github.com/billighost/sakura)";
type JsonObject = Record<string, unknown>;
function obj(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProviderError("invalid-response", "Provider returned malformed catalogue metadata");
  return value as JsonObject;
}
function name(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new ProviderError("invalid-response", "Provider omitted recording identity metadata");
  return value;
}
function https(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined; }
  catch { return undefined; }
}

async function getJson(fetcher: typeof fetch, url: string, signal?: AbortSignal, headers?: Record<string, string>) {
  for(let attempt=0;attempt<2;attempt++){
    signal?.throwIfAborted();let response:Response;
    try {response=await fetchAudioHeaders(url,{signal,headerTimeoutMs:5000,headers:{"User-Agent":USER_AGENT,...headers}},fetcher);}
    catch(error){if(signal?.aborted)throw error;if(attempt===0)continue;throw new ProviderError("unavailable","Catalogue provider did not answer");}
    if(response.status===404){await response.body?.cancel();return null;}
    if(!response.ok){await response.body?.cancel();if(attempt===0&&[429,502,503,504].includes(response.status))continue;throw new ProviderError("unavailable","Catalogue provider is unavailable");}
    try{return await readMetadataJson(response);}catch(error){if(signal?.aborted)throw error;if(attempt===0&&error instanceof ProviderError&&(error.code==="timeout"||error.code==="unavailable"))continue;throw error;}
  }
  throw new ProviderError("unavailable","Catalogue provider did not answer");
}

export async function readMetadataText(response: Response, maximumBytes = 1024 * 1024): Promise<string> {
  // Metadata bodies have their own bounded deadline; audio does not use this path.
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError("invalid-response", "Provider returned no metadata");
  let count = 0;
  const parts: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { void reader.cancel(); reject(new ProviderError("timeout", "Catalogue metadata timed out")); }, 5000);
  });
  try {
    const read = async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        count += value.byteLength;
        if (count > maximumBytes) { await reader.cancel(); throw new ProviderError("invalid-response", "Catalogue metadata is too large"); }
        parts.push(value);
      }
      const bytes = new Uint8Array(count);
      let offset = 0;
      parts.forEach((part) => { bytes.set(part, offset); offset += part.length; });
      return new TextDecoder().decode(bytes);
    };
    return await Promise.race([read(), timeout]);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("unavailable", "Provider metadata connection ended");
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

export async function readMetadataJson(response: Response): Promise<unknown> {
  const text = await readMetadataText(response);
  try { return JSON.parse(text) as unknown; }
  catch { throw new ProviderError("invalid-response", "Provider returned unreadable metadata"); }
}

/** Exact /track/:id fetch. Search results and preview URLs never become audio assets. */
export class DeezerCatalogProvider implements CatalogProvider {
  readonly provider = "deezer" as const;
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async getByIsrc(isrc: string, signal?: AbortSignal): Promise<readonly CatalogRecording[]> {
    referenceKey({ provider: "isrc", id: isrc });
    const payload = await getJson(this.fetcher, `https://api.deezer.com/track/isrc:${encodeURIComponent(isrc.toUpperCase())}`, signal);
    if (!payload) return [];
    const candidate = obj(payload);
    if (candidate.error || !/^[1-9]\d{0,17}$/.test(String(candidate.id))) return [];
    // The lookup may redirect to a replacement catalogue row; its exact metadata
    // and returned identifier must provide the same recording proof.
    const exact = await this.getExact({ provider: "deezer", id: String(candidate.id) }, signal);
    return exact?.references.some(ref => ref.provider === "isrc" && ref.id.toUpperCase() === isrc.toUpperCase()) ? [exact] : [];
  }
  async getExact(reference: ProviderReference, signal?: AbortSignal): Promise<CatalogRecording | null> {
    if (reference.provider !== "deezer" || !/^[1-9]\d{0,17}$/.test(reference.id)) throw new ProviderError("invalid-response", "Invalid Deezer reference");
    const payload = await getJson(this.fetcher, `https://api.deezer.com/track/${reference.id}`, signal);
    if (!payload) return null;
    const track = obj(payload);
    if (track.error) {
      const error = obj(track.error);
      if (error.code === 800 || error.type === "DataException") return null;
      throw new ProviderError("unavailable", "Deezer catalogue is unavailable");
    }
    if (String(track.id) !== reference.id) throw new ProviderError("invalid-response", "Catalogue ID does not match the requested track");
    const artist = obj(track.artist);
    const artists = [name(artist.name)];
    const artistCredits:ArtistCredit[]=[{name:artists[0],role:"primary",...(artist.id?{reference:{provider:"deezer" as const,id:String(artist.id)}}:{})}];
    for (const contributor of Array.isArray(track.contributors) ? track.contributors : []) {
      const item = obj(contributor);
      if ((item.role === "Main" || item.role === "Featured") && typeof item.name === "string" && !artists.includes(item.name)) {
        artists.push(item.name);artistCredits.push({name:item.name,role:"featured",...(item.id?{reference:{provider:"deezer" as const,id:String(item.id)}}:{})});
      }
    }
    const references: ProviderReference[] = [{ ...reference }];
    if (typeof track.isrc === "string") {
      const isrc = { provider: "isrc" as const, id: track.isrc };
      try { referenceKey(isrc); references.push(isrc); } catch { /* Missing/malformed optional ISRC is not identity proof. */ }
    }
    const duration = Number(track.duration);
    const version = typeof track.title_version === "string" && track.title_version.trim() ? parseRecordingTitle(`recording (${track.title_version})`).version : undefined;
    const metadata = parseRecordingMetadata({ title: name(track.title), artists,artistsComplete:true,durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : null, explicit: track.explicit_lyrics === true ? "explicit" : "unknown", ...(version ? { version } : {}) });
    const album = track.album ? obj(track.album) : null;
    return { reference: { ...reference }, references, metadata,artistCredits,coverUrl: album ? https(album.cover_xl ?? album.cover_big ?? album.cover_medium) : undefined, albumTitle: album && typeof album.title === "string" ? album.title : undefined, artistImageUrl: https(artist.picture_big ?? artist.picture_medium), artistReference: artist.id ? { provider: "deezer", id: String(artist.id) } : undefined, albumReference: album?.id ? { provider: "deezer", id: String(album.id) } : undefined, popularity: typeof track.rank === "number" ? track.rank : 0 };
  }
}

/** Credentials are configured on the server; never passed in public resolver input. */
export class SpotifyCatalogProvider implements CatalogProvider {
  readonly provider = "spotify" as const;
  private token: { value: string; expiresAt: number } | null = null;
  private metadata = new Map<string,{value:unknown;expires:number}>();
  constructor(private readonly clientId: string, private readonly clientSecret: string, private readonly fetcher: typeof fetch = fetch) {}
  async getByIsrc(isrc: string, signal?: AbortSignal): Promise<readonly CatalogRecording[]> {
    referenceKey({ provider: "isrc", id: isrc });
    const payload = obj(await this.getMetadata(`/search?type=track&limit=4&q=${encodeURIComponent("isrc:" + isrc.toUpperCase())}`, signal));
    const tracks = obj(payload.tracks);
    const candidates: CatalogRecording[] = [];
    for (const raw of (Array.isArray(tracks.items) ? tracks.items : []).slice(0, 4)) {
      const item = obj(raw);
      if (typeof item.id !== "string" || !/^[A-Za-z0-9]{22}$/.test(item.id)) continue;
      const exact = await this.getExact({ provider: "spotify", id: item.id }, signal);
      if (exact?.references.some(ref => ref.provider === "isrc" && ref.id.toUpperCase() === isrc.toUpperCase())) candidates.push(exact);
    }
    return candidates;
  }
  private async bearer(signal?: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30000) return this.token.value;
    if (!this.clientId || !this.clientSecret) throw new ProviderError("not-configured", "Spotify catalogue credentials are not configured");
    const response = await fetchAudioHeaders("https://accounts.spotify.com/api/token", {
      method: "POST", signal, headerTimeoutMs: 5000,
      headers: { Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    }, this.fetcher);
    if (!response.ok) { await response.body?.cancel(); throw new ProviderError("unavailable", "Spotify catalogue authorization failed"); }
    const token = obj(await readMetadataJson(response));
    if (typeof token.access_token !== "string" || typeof token.expires_in !== "number") throw new ProviderError("invalid-response", "Spotify returned an invalid token response");
    this.token = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
    return this.token.value;
  }
  /** Server-only public catalogue request; tokens never enter returned metadata. */
  async getMetadata(path: string, signal?: AbortSignal): Promise<unknown> {
    if (!/^\/(?:search\?|artists\/[A-Za-z0-9]{22}(?:\/(?:top-tracks|albums))?(?:\?|$)|albums\/[A-Za-z0-9]{22}(?:\/tracks)?(?:\?|$))/.test(path)) throw new ProviderError("invalid-response", "Unsupported Spotify catalogue operation");
    const cached=this.metadata.get(path);if(cached&&cached.expires>Date.now())return structuredClone(cached.value);
    const token = await this.bearer(signal);
    const value=await getJson(this.fetcher, `https://api.spotify.com/v1${path}`, signal, { Authorization: `Bearer ${token}` });
    if(value!==null){if(this.metadata.size>=400)this.metadata.delete(this.metadata.keys().next().value!);this.metadata.set(path,{value:structuredClone(value),expires:Date.now()+5*60*1000});}
    return value;
  }
  async getExact(reference: ProviderReference, signal?: AbortSignal): Promise<CatalogRecording | null> {
    if (reference.provider !== "spotify" || !/^[A-Za-z0-9]{22}$/.test(reference.id)) throw new ProviderError("invalid-response", "Invalid Spotify reference");
    const token = await this.bearer(signal);
    const payload = await getJson(this.fetcher, `https://api.spotify.com/v1/tracks/${reference.id}`, signal, { Authorization: `Bearer ${token}` });
    if (!payload) return null;
    const track = obj(payload);
    if (track.id !== reference.id) throw new ProviderError("invalid-response", "Catalogue ID does not match the requested track");
    return spotifyCatalogTrack(track);
  }
}

export function spotifyCatalogTrack(payload: unknown): CatalogRecording {
    const track = obj(payload);
    if (typeof track.id !== "string" || !/^[A-Za-z0-9]{22}$/.test(track.id)) throw new ProviderError("invalid-response", "Invalid Spotify catalogue ID");
    const reference: ProviderReference = { provider: "spotify", id: track.id };
    const artists = (Array.isArray(track.artists) ? track.artists : []).map((artist) => name(obj(artist).name));
    const artistCredits:ArtistCredit[]=(Array.isArray(track.artists)?track.artists:[]).map((value,index)=>{const artist=obj(value);return{name:name(artist.name),role:index===0?"primary":"featured",...(typeof artist.id==="string"?{reference:{provider:"spotify" as const,id:artist.id}}:{})};});
    const references: ProviderReference[] = [reference];
    const external = track.external_ids ? obj(track.external_ids) : {};
    if (typeof external.isrc === "string") {
      const isrc = { provider: "isrc" as const, id: external.isrc };
      try { referenceKey(isrc); references.push(isrc); } catch { /* Optional invalid ISRC is ignored. */ }
    }
    const album = track.album ? obj(track.album) : {};
    const images = Array.isArray(album.images) ? album.images : [];
    const firstArtist = Array.isArray(track.artists) && track.artists[0] ? obj(track.artists[0]) : {};
    return { reference: { ...reference }, references, metadata: parseRecordingMetadata({ title: name(track.name), artists,artistsComplete:true,durationMs: track.duration_ms, explicit: track.explicit === true ? "explicit" : "unknown" }),artistCredits,albumTitle: typeof album.name === "string" ? album.name : undefined, coverUrl: images[0] ? https(obj(images[0]).url) : undefined, artistReference: typeof firstArtist.id === "string" ? { provider: "spotify", id: firstArtist.id } : undefined, albumReference: typeof album.id === "string" ? { provider: "spotify", id: album.id } : undefined, popularity: typeof track.popularity === "number" ? track.popularity : 0 };
}

/** Public metadata cache only; never caches auth, worker secrets or signed audio URLs. */
export class CachedCatalogProvider implements CatalogProvider {
  readonly provider: CatalogProvider["provider"];
  private readonly entries = new Map<string, { value: CatalogRecording; expiresAt: number }>();
  constructor(private readonly upstream: CatalogProvider, private readonly ttlMs = 15 * 60 * 1000, private readonly capacity = 1000) { this.provider = upstream.provider; }
  async getByIsrc(isrc: string, signal?: AbortSignal): Promise<readonly CatalogRecording[]> {
    return this.upstream.getByIsrc ? this.upstream.getByIsrc(isrc, signal) : [];
  }
  async getExact(reference: ProviderReference, signal?: AbortSignal) {
    const key = referenceKey(reference);
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > Date.now()) return structuredClone(cached.value);
    if (cached) this.entries.delete(key);
    const value = await this.upstream.getExact(reference, signal);
    if (!value) return null;
    if (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value: structuredClone(value), expiresAt: Date.now() + this.ttlMs });
    return value;
  }
}
