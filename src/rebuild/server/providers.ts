import { fetchAudioHeaders } from "../core/streaming";
import { referenceKey, parseRecordingTitle, isRecordingProofReference } from "../core/identity";
import { parseRecordingMetadata } from "./input";
import { ProviderError } from "./contracts";
import type { CatalogProvider, CatalogRecording } from "./contracts";
import type { ProviderReference,ArtistCredit } from "../core/types";
import { ProviderFlight } from "./provider-flight";
import {getSharedPublicCache,setSharedPublicCache,publicCatalogMetadata} from "./redisCache";

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
    try{const value=await readMetadataJson(response);signal?.throwIfAborted();return value;}catch(error){if(signal?.aborted)throw error;if(attempt===0&&error instanceof ProviderError&&(error.code==="timeout"||error.code==="unavailable"))continue;throw error;}
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
  readonly sharedCacheEnabled:boolean;
  constructor(private readonly fetcher: typeof fetch = fetch) {this.sharedCacheEnabled=fetcher===fetch;}
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
  private readonly tokenReads = new ProviderFlight<string>(1);
  private readonly metadataReads = new ProviderFlight<unknown>();
  readonly sharedCacheEnabled:boolean;
  constructor(private readonly clientId: string, private readonly clientSecret: string, private readonly fetcher: typeof fetch = fetch) {
    this.sharedCacheEnabled=fetcher===fetch;
  }
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
    signal?.throwIfAborted();
    if (this.token && this.token.expiresAt > Date.now() + 30000) return this.token.value;
    if (!this.clientId || !this.clientSecret) throw new ProviderError("not-configured", "Spotify catalogue credentials are not configured");
    return this.tokenReads.run("token",signal,async sharedSignal=>{
      const response = await fetchAudioHeaders("https://accounts.spotify.com/api/token", {
        method: "POST", signal:sharedSignal, headerTimeoutMs: 5000,
        headers: { Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      }, this.fetcher);
      if (!response.ok) { await response.body?.cancel(); throw new ProviderError("unavailable", "Spotify catalogue authorization failed"); }
      const token = obj(await readMetadataJson(response));
      sharedSignal.throwIfAborted();
      if (typeof token.access_token !== "string" || typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in<=0) throw new ProviderError("invalid-response", "Spotify returned an invalid token response");
      this.token = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
      return this.token.value;
    });
  }
  /** Server-only public catalogue request; tokens never enter returned metadata. */
  async getMetadata(path: string, signal?: AbortSignal): Promise<unknown> {
    if (!/^\/(?:search\?|artists\/[A-Za-z0-9]{22}(?:\/(?:top-tracks|albums))?(?:\?|$)|albums\/[A-Za-z0-9]{22}(?:\/tracks)?(?:\?|$))/.test(path)) throw new ProviderError("invalid-response", "Unsupported Spotify catalogue operation");
    signal?.throwIfAborted();
    const cached=this.metadata.get(path);if(cached&&cached.expires>Date.now())return structuredClone(cached.value);
    if(cached)this.metadata.delete(path);
    const value=await this.metadataReads.run(path,signal,async sharedSignal=>{
      const shared=this.sharedCacheEnabled?await getSharedPublicCache<unknown>("provider_spotify",`metadata:${path}`):undefined;
      sharedSignal.throwIfAborted();
      if(shared&&typeof shared==="object"&&!Array.isArray(shared)&&!(shared as Record<string,unknown>).error){
        if(this.metadata.size>=400)this.metadata.delete(this.metadata.keys().next().value!);
        this.metadata.set(path,{value:structuredClone(shared),expires:Date.now()+30000});
        return shared;
      }
      const token = await this.bearer(sharedSignal);
      const result=await getJson(this.fetcher, `https://api.spotify.com/v1${path}`, sharedSignal, { Authorization: `Bearer ${token}` });
      sharedSignal.throwIfAborted();
      if(result!==null){
        if(this.metadata.size>=400)this.metadata.delete(this.metadata.keys().next().value!);
        this.metadata.set(path,{value:structuredClone(result),expires:Date.now()+5*60*1000});
        if(this.sharedCacheEnabled)await setSharedPublicCache("provider_spotify",`metadata:${path}`,publicCatalogMetadata(result),300);
        sharedSignal.throwIfAborted();
      }
      return result;
    });
    return structuredClone(value);
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
function sharedCatalog(value:unknown,provider:CatalogProvider["provider"]):CatalogRecording|undefined{
  try{
    const raw=obj(value),ref=raw.reference as ProviderReference;
    if(!isRecordingProofReference(ref)||ref.provider!==provider||!Array.isArray(raw.references)||raw.references.length<1||raw.references.length>16)return;
    const references=raw.references as ProviderReference[];
    if(!references.every(isRecordingProofReference)||!references.some(proof=>referenceKey(proof)===referenceKey(ref)))return;
    const credits=raw.artistCredits as ArtistCredit[]|undefined;
    if(credits!==undefined&&(!Array.isArray(credits)||credits.length>30||!credits.every(credit=>credit&&typeof credit.name==="string"&&credit.name.length>0&&credit.name.length<=300&&(credit.role==="primary"||credit.role==="featured")&&(!credit.reference||isRecordingProofReference(credit.reference)))))return;
    for(const field of ["artistReference","albumReference"] as const)if(raw[field]!==undefined&&!isRecordingProofReference(raw[field] as ProviderReference))return;
    if(raw.genres!==undefined&&(!Array.isArray(raw.genres)||raw.genres.length>80||!raw.genres.every(genre=>typeof genre==="string"&&genre.length<=300)))return;
    return {reference:{...ref},references:references.map(proof=>({...proof})),metadata:parseRecordingMetadata(raw.metadata),
      ...(typeof raw.albumTitle==="string"?{albumTitle:raw.albumTitle}:{}),...(https(raw.coverUrl)?{coverUrl:https(raw.coverUrl)}:{}),...(https(raw.artistImageUrl)?{artistImageUrl:https(raw.artistImageUrl)}:{}),
      ...(raw.artistReference?{artistReference:{...raw.artistReference as ProviderReference}}:{}),...(raw.albumReference?{albumReference:{...raw.albumReference as ProviderReference}}:{}),
      ...(credits?{artistCredits:structuredClone(credits)}:{}),...(Array.isArray(raw.genres)?{genres:raw.genres as string[]}:{}),...(typeof raw.popularity==="number"&&Number.isFinite(raw.popularity)?{popularity:raw.popularity}:{})};
  }catch{return;}
}

export class CachedCatalogProvider implements CatalogProvider {
  readonly provider: CatalogProvider["provider"];
  private readonly entries = new Map<string, { value: CatalogRecording; expiresAt: number }>();
  private readonly reads = new ProviderFlight<CatalogRecording|null>();
  private readonly isrcReads = new ProviderFlight<readonly CatalogRecording[]>(200);
  private readonly isrcEntries=new Map<string,{value:readonly CatalogRecording[];expiresAt:number}>();
  private readonly sharedCacheEnabled:boolean;
  constructor(private readonly upstream: CatalogProvider, private readonly ttlMs = 15 * 60 * 1000, private readonly capacity = 1000) {
    this.provider = upstream.provider;
    this.sharedCacheEnabled=(upstream instanceof DeezerCatalogProvider||upstream instanceof SpotifyCatalogProvider)&&upstream.sharedCacheEnabled;
  }
  async getByIsrc(isrc: string, signal?: AbortSignal): Promise<readonly CatalogRecording[]> {
    signal?.throwIfAborted();
    const key=referenceKey({provider:"isrc",id:isrc});
    if(!this.upstream.getByIsrc)return [];
    const cached=this.isrcEntries.get(key);if(cached&&cached.expiresAt>Date.now())return structuredClone(cached.value);
    if(cached)this.isrcEntries.delete(key);
    return structuredClone(await this.isrcReads.run(key,signal,async sharedSignal=>{
      const saved=this.sharedCacheEnabled?await getSharedPublicCache<{version?:number;records?:unknown[]}>(this.provider==="deezer"?"provider_deezer":"provider_spotify",`isrc:v1:${key}`):undefined;
      sharedSignal.throwIfAborted();
      const shared=saved?.version===1&&Array.isArray(saved.records)&&saved.records.length>0&&saved.records.length<=4?saved.records.map(value=>sharedCatalog(value,this.provider)):undefined;
      const valid=shared&&shared.every(value=>value&&value.references.some(proof=>referenceKey(proof)===key));
      const records=valid?shared as CatalogRecording[]:await this.upstream.getByIsrc!(isrc,sharedSignal);
      sharedSignal.throwIfAborted();
      // Empty results are deliberately not retained across instances: catalog
      // availability and ISRC replacements can change independently.
      if(records.length){
        if(this.isrcEntries.size>=200)this.isrcEntries.delete(this.isrcEntries.keys().next().value!);
        this.isrcEntries.set(key,{value:structuredClone(records),expiresAt:Date.now()+(valid?30000:this.ttlMs)});
        if(this.sharedCacheEnabled&&!valid)await setSharedPublicCache(this.provider==="deezer"?"provider_deezer":"provider_spotify",`isrc:v1:${key}`,publicCatalogMetadata({version:1,records}),Math.min(86400,Math.max(1,Math.floor(this.ttlMs/1000))));
      }
      return records;
    }));
  }
  async getExact(reference: ProviderReference, signal?: AbortSignal) {
    const key = referenceKey(reference);
    signal?.throwIfAborted();
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > Date.now()) return structuredClone(cached.value);
    if (cached) this.entries.delete(key);
    const value=await this.reads.run(key,signal,async sharedSignal=>{
      const scope=this.provider==="deezer"?"provider_deezer":"provider_spotify";
      const saved=this.sharedCacheEnabled?await getSharedPublicCache<{version?:number;record?:unknown}>(scope,`exact:v1:${key}`):undefined;
      sharedSignal.throwIfAborted();
      const shared=saved?.version===1?sharedCatalog(saved.record,this.provider):undefined;
      if(shared&&referenceKey(shared.reference)===key){
        if(this.entries.size>=this.capacity)this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(key,{value:structuredClone(shared),expiresAt:Date.now()+Math.min(this.ttlMs,30000)});return shared;
      }
      const result = await this.upstream.getExact({...reference}, sharedSignal);
      sharedSignal.throwIfAborted();
      if (!result) return null;
      if (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!);
      this.entries.set(key, { value: structuredClone(result), expiresAt: Date.now() + this.ttlMs });
      if(this.sharedCacheEnabled)await setSharedPublicCache(scope,`exact:v1:${key}`,publicCatalogMetadata({version:1,record:result}),Math.min(86400,Math.max(1,Math.floor(this.ttlMs/1000))));
      sharedSignal.throwIfAborted();
      return result;
    });
    return structuredClone(value);
  }
}
