import type {DownloadEntry, MusicTrack} from "./types";
import type {OfflineAudio} from "./offline";

export interface DownloadSource {
 track:MusicTrack;url:string;fallbackUrl?:string;assetId:string;sizeBytes:number;sha256?:string;
}
export interface DownloadFingerprint {assetId:string;sizeBytes:number;sha256:string}
export interface PartialDownloadRecord {
 version:1;recordingId:string;track:MusicTrack;status:DownloadEntry["status"];
 mode:"full"|"prefix";requested:boolean;priority:number;chunkBytes:number;createdAt:number;updatedAt:number;
 fingerprint?:DownloadFingerprint;mimeType?:string;error?:string;refreshSource?:boolean;
}
export interface DownloadChunk {offset:number;blob:Blob;sha256:string}
/** Every implementation must atomically publish complete audio and delete its partials. */
export interface DownloadStorage {
 list():Promise<PartialDownloadRecord[]>;
 read(id:string):Promise<PartialDownloadRecord|undefined>;
 save(record:PartialDownloadRecord):Promise<void>;
 chunks(id:string):Promise<DownloadChunk[]>;
 putChunk(id:string,chunk:DownloadChunk):Promise<void>;
 ready(id:string):Promise<OfflineAudio|undefined>;
 allReady():Promise<OfflineAudio[]>;
 finalize(id:string,audio:OfflineAudio):Promise<void>;
 /** Durably promote a complete cache and remove obsolete partial manifests atomically. */
 promoteRequested(id:string):Promise<OfflineAudio|undefined>;
 clear(id:string,includeReady?:boolean):Promise<void>;
 /** Check requested flags and delete automatic cache in one transaction. */
 clearAutomatic(id:string):Promise<boolean>;
 /** Atomic expiring lease is the fallback on browsers without Web Locks. */
 lease(id:string,owner:string,expiresAt:number):Promise<boolean>;
 release(id:string,owner:string):Promise<void>;
}
