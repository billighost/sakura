import type { RecordingRepository, ResolveRecordingResult } from "./contracts";
import type { SourceAudioTransport } from "./gateway";
/** Signed playback URLs are minted on read, never persisted into job/catalog rows. */
export class PlaybackTargets {
 constructor(private readonly repository:RecordingRepository,private readonly transport:SourceAudioTransport){}
 async decorate(result:ResolveRecordingResult,accountId:string):Promise<ResolveRecordingResult>{
  if(result.status!=="resolved")return result;
  const asset=await this.repository.findAudio(result.recording.recordingId,result.playback.assetId,accountId);
  if(!asset)return result;
  const url=await this.transport.signedPlaybackUrl(asset);
  const gatewayUrl=`/api/v2/recordings/${encodeURIComponent(result.recording.recordingId)}/audio?assetId=${encodeURIComponent(result.playback.assetId)}`;
  return url?{...result,playback:{...result.playback,url,...(url!==gatewayUrl?{fallbackUrl:gatewayUrl}:{})}}:result;
 }
}
