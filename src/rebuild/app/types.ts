import type { ProviderReference, RecordingVersion } from "../core/types";
import type {ReadyPlayback} from "../data/catalog";
import type {AudioTechnology} from "../audio/presets";
import { collectionDate } from "../core/collectionDate";
export interface MusicTrack {
 id: string;
 title: string;
 artists: string[];
 artistsComplete?: boolean;
 artistCredits?: {artistId?:string|null;name:string;role:"primary"|"featured";reference?:ProviderReference}[];
 artistId: string | null;
 albumId: string | null;
 albumTitle: string | null;
 durationMs: number;
 coverUrl: string | null;
 genres?: string[];
 versionLabel: string;
 version?: RecordingVersion;
 reference: ProviderReference;
 references: ProviderReference[];
 audioUrl?: string;
 readyPlayback?: ReadyPlayback;
 explicit?: boolean;
 /** When this recording was added to the current library or collection. */
 addedAt?: string | number;
}
export interface Account { id:string;username:string;email:string;avatarUrl?:string|null; }
export type PlaybackStatus = "idle"|"resolving"|"buffering"|"playing"|"paused"|"error";
export interface QueueEntry {entryId:string;track:MusicTrack;priority?:"manual"|"automatic";localOnly?:boolean;context?:string;contextId?:string}
export interface DownloadEntry {
 recordingId:string;track:MusicTrack;status:"queued"|"resolving"|"downloading"|"paused"|"prepared"|"ready"|"failed";
 downloadedBytes:number;totalBytes:number|null;error?:string;operationId:string;sha256?:string;
 /** Prefix preparation stays out of the explicit download list. */
 requested?:boolean;cachedSeconds?:number;activeChunks?:number;updatedAt?:number;
}
export type PlayerModal = "queue"|"share"|"lyrics"|"player"|null;
export interface UserSettings {theme:"system"|"light"|"dark";audioQuality:"high"|"balanced"|"data-saver";audioTechnology?:AudioTechnology;privateSession:boolean;discovery:number;artistVariety?:number;repeatTolerance?:number;newReleaseBias?:number;deepCutBias?:number;timeAware?:boolean;learnFromListening?:boolean;reducedMotion:boolean;openingAnimation:number;bloomPerformance?:"auto"|"1"|"2"|"3"|"4"|"5";seedArtists:string[];seedGenres:string[];seedArtistSelections?:{name:string;reference:ProviderReference;selectionKey:string}[];timeZone?:string;explicitContent?:boolean;onboarded:boolean;volume?:number;shuffle?:boolean;repeat?:"off"|"one"|"all";previewVolume?:number;previewLoop?:boolean;sleepTimerMinutes?:number; }
/** Normalize catalog and persisted cards at the API boundary, never by fuzzy title identity. */
export function musicTrack(raw:Record<string,unknown>):MusicTrack {
 const metadata=(raw.metadata&&typeof raw.metadata==="object"?raw.metadata:raw) as Record<string,unknown>;
 const references=(Array.isArray(raw.references)?raw.references:raw.reference?[raw.reference]:[]) as ProviderReference[];
 const reference=(raw.reference||references.find(r=>r.provider==="deezer"||r.provider==="spotify")) as ProviderReference|undefined;
 if(!reference||typeof reference.id!=="string")throw new Error("The song has no catalog reference.");
 const version=metadata.version as {kinds?:string[];labels?:string[]}|undefined;
 return {id:String(raw.recordingId||raw.id||reference.provider+":"+reference.id),title:String(metadata.title||""),artists:Array.isArray(metadata.artists)?metadata.artists.map(String):[],artistsComplete:typeof metadata.artistsComplete==="boolean"?metadata.artistsComplete:undefined,artistCredits:Array.isArray(raw.artistCredits)?raw.artistCredits as MusicTrack["artistCredits"]:Array.isArray(metadata.artistCredits)?metadata.artistCredits as MusicTrack["artistCredits"]:undefined,
 artistId:raw.artistId?String(raw.artistId):null,albumId:raw.albumId?String(raw.albumId):null,albumTitle:raw.albumTitle||metadata.albumTitle?String(raw.albumTitle||metadata.albumTitle):null,
 durationMs:Number(metadata.durationMs)||0,coverUrl:typeof (raw.coverUrl||metadata.coverUrl)==="string"?String(raw.coverUrl||metadata.coverUrl):null,versionLabel:typeof raw.versionLabel==="string"?raw.versionLabel:version?.labels?.length?version.labels.join(" · "):version?.kinds?.length?version.kinds.join(" · "):"Original recording",
 reference,references:references.length?references:[reference],explicit:metadata.explicit==="explicit",version:version as RecordingVersion|undefined,genres:Array.isArray(raw.genres)?raw.genres.map(String):[],readyPlayback:raw.readyPlayback as ReadyPlayback|undefined,addedAt:collectionDate(raw.addedAt)};
}
