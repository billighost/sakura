import type { CatalogRecording } from "./contracts";
import { parseRecordingMetadata } from "./input";
import { parseRecordingTitle } from "../core/identity";
import { fetchAudioHeaders } from "../core/streaming";
import { readMetadataJson, SpotifyCatalogProvider, spotifyCatalogTrack } from "./providers";
import { assessAudioCandidate } from "../core/matching";
import { groupArtistCards } from "../data/artistSelection";
import type { ProviderReference } from "../core/types";
import { ProviderFlight } from "./provider-flight";
import {getSharedPublicCache,setSharedPublicCache,publicCatalogMetadata} from "./redisCache";

type Row = Record<string, unknown>;
export type CatalogSearchKind = "tracks" | "artists" | "albums";
export interface CatalogSearchPage { kind?: CatalogSearchKind; cursor?: number; }
const SEARCH_LIMITS: Record<CatalogSearchKind,{deezer:number;spotify:number}> = {
  tracks:{deezer:24,spotify:10},artists:{deezer:8,spotify:10},albums:{deezer:8,spotify:10},
};
const MAX_SEARCH_PAGE=19;
function row(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function artwork(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try { const url = new URL(value); return url.protocol === "https:" ? url.toString() : undefined; } catch { return undefined; }
}
export function catalogTrack(raw: unknown): CatalogRecording | null {
  const item = row(raw);
  const artist = row(item.artist);
  const album = row(item.album);
  if (!item.id || typeof item.title !== "string" || typeof artist.name !== "string" || !artist.name) return null;
  const version = typeof item.title_version === "string" && item.title_version ? parseRecordingTitle(`track (${item.title_version})`).version : undefined;
  const contributors = Array.isArray(item.contributors) ? item.contributors.map(row).filter((credit) => credit.role === "Main" || credit.role === "Featured").map((credit) => String(credit.name)) : [];
  const reference = { provider: "deezer" as const, id: String(item.id) };
  const artistCredits=[{name:artist.name,role:"primary" as const,...(artist.id?{reference:{provider:"deezer" as const,id:String(artist.id)}}:{})},...(Array.isArray(item.contributors)?item.contributors.map(row).filter(credit=>(credit.role==="Main"||credit.role==="Featured")&&typeof credit.name==="string"&&credit.name!==artist.name).map(credit=>({name:String(credit.name),role:"featured" as const,...(credit.id?{reference:{provider:"deezer" as const,id:String(credit.id)}}:{})})):[])];
  return { reference, references: [reference], metadata: parseRecordingMetadata({ title: item.title, artists: [...new Set([artist.name, ...contributors])],artistsComplete:Array.isArray(item.contributors),durationMs: Number(item.duration) > 0 ? Math.round(Number(item.duration) * 1000) : null, version, explicit: item.explicit_lyrics === true ? "explicit" : "unknown" }),
    coverUrl: artwork(album.cover_xl ?? album.cover_big ?? album.cover_medium), artistImageUrl: artwork(artist.picture_big ?? artist.picture_medium), albumTitle: typeof album.title === "string" ? album.title : undefined,
    artistReference: artist.id ? { provider: "deezer", id: String(artist.id) } : undefined, albumReference: album.id ? { provider: "deezer", id: String(album.id) } : undefined,
    artistId: artist.id ? `deezer:${artist.id}` : null,albumId: album.id ? `deezer:${album.id}` : null,artistCredits,
    popularity: typeof item.rank === "number" ? item.rank : 0 };
}

export class DeezerCatalogService {
  private cache = new Map<string, { expires: number; value: unknown }>();
  private readonly reads = new ProviderFlight<unknown>();
  private readonly sharedCacheEnabled:boolean;
  constructor(private readonly fetcher: typeof fetch = fetch,private readonly spotify?:SpotifyCatalogProvider) {
    // Injected transports serve fixtures/private test environments; they must
    // never publish synthetic data to a configured production Redis cache.
    this.sharedCacheEnabled=fetcher===fetch;
  }
  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const cached = this.cache.get(path);
    if (cached && cached.expires > Date.now()) return structuredClone(cached.value);
    if(cached)this.cache.delete(path);
    const value=await this.reads.run(path,signal,async sharedSignal=>{
      const shared=this.sharedCacheEnabled?await getSharedPublicCache<unknown>("provider_deezer",`metadata:${path}`):undefined;
      sharedSignal.throwIfAborted();
      if(shared&&typeof shared==="object"&&!Array.isArray(shared)&&!row(shared).error){
        if(this.cache.size>=400)this.cache.delete(this.cache.keys().next().value!);
        // A short L1 lease avoids extending a nearly expired shared entry by
        // another full five minutes on each newly started server instance.
        this.cache.set(path,{value:structuredClone(shared),expires:Date.now()+30000});
        return shared;
      }
      const response = await fetchAudioHeaders(`https://api.deezer.com${path}`, { signal:sharedSignal, headerTimeoutMs: 6000, headers: { "User-Agent": "Sakura/2.0 (https://github.com/billighost/sakura)" } }, this.fetcher);
      if (!response.ok) { await response.body?.cancel(); throw new Error("Catalogue provider is unavailable"); }
      const result = await readMetadataJson(response);
      sharedSignal.throwIfAborted();
      if (row(result).error) throw new Error("Catalogue provider returned an error");
      if (this.cache.size >= 400) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(path, { value: structuredClone(result), expires: Date.now() + 5 * 60 * 1000 });
      if(this.sharedCacheEnabled)await setSharedPublicCache("provider_deezer",`metadata:${path}`,publicCatalogMetadata(result),300);
      sharedSignal.throwIfAborted();
      return result;
    });
    return structuredClone(value);
  }
  async search(query: string, signal?: AbortSignal, page: CatalogSearchPage = {}) {
    signal?.throwIfAborted();
    const clean = query.trim().slice(0, 200);
    const cursor=Number.isInteger(page.cursor)&&Number(page.cursor)>=0&&Number(page.cursor)<=MAX_SEARCH_PAGE?Number(page.cursor):0;
    const requested=page.kind?[page.kind] as CatalogSearchKind[]:["tracks","artists","albums"] as CatalogSearchKind[];
    if (!clean) return { query: clean, tracks: [], artists: [], albums: [],totals:{tracks:0,artists:0,albums:0},nextCursors:{tracks:null,artists:null,albums:null} };
    const deezerPath=(kind:CatalogSearchKind)=>{
      const limit=SEARCH_LIMITS[kind].deezer,offset=cursor*limit,entity=kind==="tracks"?"track":kind==="artists"?"artist":"album";
      return `/search/${entity}?q=${encodeURIComponent(clean)}&limit=${limit}&index=${offset}`;
    };
    const spotifyTypes=requested.map(kind=>kind==="tracks"?"track":kind==="artists"?"artist":"album").join(",");
    const spotifyLimit=page.kind?SEARCH_LIMITS[page.kind].spotify:10;
    const spotifyOffset=cursor*spotifyLimit;
    const results = await Promise.allSettled([
      requested.includes("tracks")?this.get(deezerPath("tracks"), signal):Promise.resolve(null),
      requested.includes("artists")?this.get(deezerPath("artists"), signal):Promise.resolve(null),
      requested.includes("albums")?this.get(deezerPath("albums"), signal):Promise.resolve(null),
      this.spotify?this.spotify.getMetadata(`/search?q=${encodeURIComponent(clean)}&type=${spotifyTypes}&limit=${spotifyLimit}&offset=${spotifyOffset}`,signal):Promise.resolve(null),
    ]);
    signal?.throwIfAborted();
    const payload=(index:number)=>results[index].status==="fulfilled"?row(results[index].value):{};
    const data = (index: number) => Array.isArray(payload(index).data) ? payload(index).data as unknown[] : [];
    const spotify=results[3].status==="fulfilled"?row(results[3].value):{};
    const requestedIndexes=requested.map(kind=>kind==="tracks"?0:kind==="artists"?1:2);
    if (requestedIndexes.every(index=>results[index].status === "rejected")&&!Object.keys(spotify).length) throw new Error("Catalogue search is unavailable");
    const items=(value:unknown)=>Array.isArray(row(value).items)?row(value).items as unknown[]:[];
    const tracks=data(0).map(catalogTrack).filter((track): track is CatalogRecording => !!track);
    for(const value of items(spotify.tracks)){
      try{const track=spotifyCatalogTrack(value);if(!tracks.some(existing=>assessAudioCandidate(existing,{candidateId:"display",metadata:track.metadata,audioKind:"full"}).acceptable))tracks.push({...track,artistId:track.artistReference?`spotify:${track.artistReference.id}`:null,albumId:track.albumReference?`spotify:${track.albumReference.id}`:null});}catch{/* Ignore malformed search cards; exact ingestion revalidates selected records. */}
    }
    const artists:{id:string;reference:ProviderReference;name:string;imageUrl?:string;albumCount:number}[]=data(1).map(row).filter((artist) => artist.id && artist.name).map((artist) => ({ id:`deezer:${artist.id}`,reference: { provider: "deezer", id: String(artist.id) }, name: String(artist.name), imageUrl: artwork(artist.picture_big ?? artist.picture_medium), albumCount: Number(artist.nb_album) || 0 }));
    for(const artist of items(spotify.artists).map(row)){if(typeof artist.id!=="string"||typeof artist.name!=="string")continue;artists.push({id:`spotify:${artist.id}`,reference:{provider:"spotify",id:artist.id},name:artist.name,imageUrl:artwork(row(items({items:artist.images})[0]).url),albumCount:0});}
    const albums=data(2).map(row).filter((album) => album.id && album.title).map((album) => ({ id:`deezer:${album.id}`,reference: { provider: "deezer", id: String(album.id) }, title: String(album.title),artistName:String(row(album.artist).name??""), artist: String(row(album.artist).name ?? ""), coverUrl: artwork(album.cover_big ?? album.cover_medium) }));
    for(const album of items(spotify.albums).map(row)){const artist=String(row(Array.isArray(album.artists)?album.artists[0]:null).name??"");if(typeof album.id!=="string"||typeof album.name!=="string"||albums.some(existing=>existing.title===album.name&&existing.artist===artist))continue;albums.push({id:`spotify:${album.id}`,reference:{provider:"spotify",id:album.id},title:album.name,artistName:artist,artist,coverUrl:artwork(row(Array.isArray(album.images)?album.images[0]:null).url)});}
    const spotifySection=(kind:CatalogSearchKind)=>row(spotify[kind]);
    const total=(value:unknown)=>Number.isFinite(Number(value))&&Number(value)>=0?Number(value):0;
    const totals={tracks:total(payload(0).total)+total(spotifySection("tracks").total),artists:total(payload(1).total)+total(spotifySection("artists").total),albums:total(payload(2).total)+total(spotifySection("albums").total)};
    const hasNext=(kind:CatalogSearchKind,index:number)=>{
      if(!requested.includes(kind)||cursor>=MAX_SEARCH_PAGE)return false;
      const deezer=payload(index),spotifyPage=spotifySection(kind),limits=SEARCH_LIMITS[kind];
      const deezerMore=typeof deezer.next==="string"&&deezer.next.length>0||total(deezer.total)>(cursor+1)*limits.deezer;
      const spotifyMore=typeof spotifyPage.next==="string"&&spotifyPage.next.length>0||total(spotifyPage.total)>(cursor+1)*limits.spotify;
      return deezerMore||spotifyMore;
    };
    const nextCursors={tracks:hasNext("tracks",0)?String(cursor+1):null,artists:hasNext("artists",1)?String(cursor+1):null,albums:hasNext("albums",2)?String(cursor+1):null};
    return {query:clean,tracks,artists:groupArtistCards(artists),albums,totals,nextCursors};
  }
  async detail(kind: "artist" | "album" | "playlist", id: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if(id.startsWith("spotify:"))return this.spotifyDetail(kind,id.slice(8),signal);
    if(id.startsWith("deezer:"))id=id.slice(7);
    if (!/^[1-9]\d{0,17}$/.test(id)) throw new Error("Invalid catalogue ID");
    const [entityPayload,artistTracks,artistAlbums]=kind==="artist"?await Promise.all([
      this.get(`/artist/${id}`,signal),this.get(`/artist/${id}/top?limit=50`,signal),this.get(`/artist/${id}/albums?limit=24`,signal),
    ]):[await this.get(`/${kind}/${id}`,signal),undefined,undefined];
    const entity = row(entityPayload);
    const tracksPayload = kind === "artist" ? artistTracks : entity.tracks;
    const tracks = (Array.isArray(row(tracksPayload).data) ? row(tracksPayload).data as unknown[] : []).map((raw) => {
      const item = row(raw);
      return catalogTrack(kind === "album" ? { ...item, album: { id: entity.id, title: entity.title, cover_xl: entity.cover_xl, cover_big: entity.cover_big }, artist: item.artist ?? entity.artist } : item);
    }).filter((track): track is CatalogRecording => !!track);
    const albums = kind === "artist" ? row(artistAlbums).data : undefined;
    return { kind, reference: { provider: "deezer", id }, title: String(entity.name ?? entity.title ?? ""), name: String(entity.name ?? entity.title ?? ""),
      imageUrl: artwork(entity.picture_xl ?? entity.picture_big ?? entity.cover_xl ?? entity.cover_big ?? entity.picture_medium), coverUrl: artwork(entity.cover_xl ?? entity.cover_big ?? entity.picture_xl ?? entity.picture_big),
      description: typeof entity.description === "string" ? entity.description : "", artist: row(entity.artist).name ? String(row(entity.artist).name) : undefined,
      artistReference: row(entity.artist).id ? { provider: "deezer", id: String(row(entity.artist).id) } : undefined,
      releaseDate: typeof entity.release_date === "string" ? entity.release_date : undefined, genres: Array.isArray(row(entity.genres).data) ? (row(entity.genres).data as unknown[]).map((genre) => String(row(genre).name ?? "")).filter(Boolean) : [],
      tracks, albums: Array.isArray(albums) ? albums.map(row).map((album) => ({ id:`deezer:${album.id}`,reference: { provider: "deezer", id: String(album.id) }, title: String(album.title ?? ""), coverUrl: artwork(album.cover_big ?? album.cover_medium), releaseDate: album.release_date })) : [] };
  }
  private async spotifyDetail(kind:"artist"|"album"|"playlist",id:string,signal?:AbortSignal){
    if(!this.spotify||! /^[A-Za-z0-9]{22}$/.test(id)||kind==="playlist")throw new Error("This Spotify collection is unavailable.");
    const provider=this.spotify,entity=row(await provider.getMetadata(`/${kind}s/${id}`,signal));
    if(!entity.id)throw new Error("Spotify collection was not found.");
    const optional=kind==="artist"?await Promise.allSettled([provider.getMetadata(`/artists/${id}/top-tracks?market=NG`,signal),provider.getMetadata(`/artists/${id}/albums?include_groups=album,single&limit=10`,signal)]):[];
    signal?.throwIfAborted();
    const trackData=kind==="artist"?row(optional[0].status==="fulfilled"?optional[0].value:null).tracks:row(entity.tracks).items;
    const tracks=(Array.isArray(trackData)?trackData:[]).flatMap(raw=>{
      try{return[spotifyCatalogTrack(kind==="album"?{...row(raw),album:entity}:raw)];}catch{return[];}
    });
    const albumData=kind==="artist"?row(optional[1].status==="fulfilled"?optional[1].value:null).items:[];
    const artist=row(Array.isArray(entity.artists)?entity.artists[0]:null);
    let artistImageUrl:string|undefined;
    if(kind==="album"&&typeof artist.id==="string"){
      try{const fullArtist=row(await provider.getMetadata(`/artists/${artist.id}`,signal));artistImageUrl=artwork(row(Array.isArray(fullArtist.images)?fullArtist.images[0]:null).url);}catch{/* Core album remains useful when optional artist enrichment fails. */}
    }
    signal?.throwIfAborted();
    const imageUrl=artwork(row(Array.isArray(entity.images)?entity.images[0]:null).url);
    return {kind,reference:{provider:"spotify",id},title:String(entity.name??""),name:String(entity.name??""),imageUrl,coverUrl:imageUrl,description:"",artist:typeof artist.name==="string"?artist.name:undefined,
      artistReference:typeof artist.id==="string"?{provider:"spotify",id:artist.id}:undefined,releaseDate:typeof entity.release_date==="string"?entity.release_date:undefined,
      genres:Array.isArray(entity.genres)?entity.genres.filter((genre):genre is string=>typeof genre==="string"):[],
      tracks:tracks.map(track=>({...track,artistImageUrl:kind==="artist"?imageUrl:artistImageUrl})),albums:(Array.isArray(albumData)?albumData:[]).map(row).map(album=>({id:`spotify:${album.id}`,reference:{provider:"spotify",id:String(album.id)},title:String(album.name??""),coverUrl:artwork(row(Array.isArray(album.images)?album.images[0]:null).url),releaseDate:album.release_date}))};
  }
  async charts(signal?: AbortSignal) {
    const raw = row(await this.get("/chart/0?limit=24", signal));
    return { tracks: (Array.isArray(row(raw.tracks).data) ? row(raw.tracks).data as unknown[] : []).map(catalogTrack).filter((track): track is CatalogRecording => !!track),
      artists: (Array.isArray(row(raw.artists).data) ? row(raw.artists).data as unknown[] : []).map(row).map((artist) => ({ id:`deezer:${artist.id}`,reference: { provider: "deezer", id: String(artist.id) }, name: String(artist.name ?? ""), imageUrl: artwork(artist.picture_big ?? artist.picture_medium) })) };
  }
}
