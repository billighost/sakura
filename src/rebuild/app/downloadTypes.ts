import type {DownloadEntry, MusicTrack} from "./types";
import type {OfflineAudio,OfflineAudioMetadata} from "./offline";

export interface DownloadSource {
 track:MusicTrack;url:string;fallbackUrl?:string;assetId:string;sizeBytes:number;sha256?:string;mimeType?:string;
}
export interface DownloadFingerprint {assetId:string;sizeBytes:number;sha256:string}
export interface PartialDownloadRecord {
 version:1;recordingId:string;track:MusicTrack;status:DownloadEntry["status"];
 mode:"full"|"prefix"|"playback";requested:boolean;priority:number;chunkBytes:number;createdAt:number;updatedAt:number;
 playbackOffset?:number;
 /** Playback may omit a validated leading ID3 tag; saved bytes remain original. */
 audioStartBytes?:number;
 audioOpeningEndBytes?:number;
 fingerprint?:DownloadFingerprint;mimeType?:string;error?:string;refreshSource?:boolean;
 /** Metadata for first paint; restored chunk bytes are validated lazily. */
 downloadedBytes?:number;cachedSeconds?:number;
}
export interface DownloadChunk {offset:number;blob:Blob;sha256:string}
export interface PreparedFullAudio {audio:OfflineAudio;release:()=>void}
/** Every implementation must atomically publish complete audio and delete its partials. */
export interface DownloadStorage {
 list():Promise<PartialDownloadRecord[]>;
 read(id:string):Promise<PartialDownloadRecord|undefined>;
 save(record:PartialDownloadRecord):Promise<void>;
 chunks(id:string):Promise<DownloadChunk[]>;
 chunk?(id:string,offset:number):Promise<DownloadChunk|undefined>;
 putChunk(id:string,chunk:DownloadChunk):Promise<void>;
 /** A bounded opening prefix is separate from complete resumable chunks. */
 openingChunk?(id:string,offset?:number):Promise<DownloadChunk|undefined>;
 putOpeningChunk?(id:string,chunk:DownloadChunk):Promise<void>;
 clearPlaybackFragments?(id:string,start:number,end:number):Promise<void>;
 ready(id:string):Promise<OfflineAudio|undefined>;
 allReady():Promise<OfflineAudio[]>;
 allReadyMetadata?():Promise<OfflineAudioMetadata[]>;
 finalize(id:string,audio:OfflineAudio):Promise<void>;
 /** Durably promote a complete cache and remove obsolete partial manifests atomically. */
 promoteRequested(id:string):Promise<OfflineAudio|undefined>;
 clear(id:string,includeReady?:boolean):Promise<void>;
 /** Check requested flags and delete automatic cache in one transaction. */
 clearAutomatic(id:string):Promise<boolean>;
 /** Expiring read pins protect a prepared experience from another tab's eviction. */
 pinAutomatic?(id:string,owner:string,expiresAt:number):Promise<void>;
 releaseAutomaticPin?(id:string,owner:string):Promise<void>;
 /** Release this tab's preparation pins after an account-history erasure. */
 releaseAutomaticPins?(ownerPrefix:string):Promise<void>;
 /** Atomic expiring lease is the fallback on browsers without Web Locks. */
 lease(id:string,owner:string,expiresAt:number):Promise<boolean>;
 release(id:string,owner:string):Promise<void>;
}
