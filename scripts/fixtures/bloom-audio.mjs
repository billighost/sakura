import {createHash} from "node:crypto";

/** Small valid WAV files let entrance tests exercise full-file fingerprints,
 * range downloads and local playback without contacting an audio provider. */
export function bloomAudioFixture(recordings,providedAudio){
 const samples=8000*30,audio=providedAudio||Buffer.alloc(44+samples,128);
 if(!providedAudio){audio.write("RIFF",0);audio.writeUInt32LE(audio.length-8,4);audio.write("WAVEfmt ",8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(8000,28);audio.writeUInt16LE(1,32);audio.writeUInt16LE(8,34);audio.write("data",36);audio.writeUInt32LE(samples,40);}
 const sha256=createHash("sha256").update(audio).digest("hex");
 return async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path==="/api/v2/recordings/resolve"){
   const reference=request.postDataJSON().reference,recording=recordings.find(value=>value.reference?.provider===reference?.provider&&value.reference?.id===reference?.id);
   if(!recording)throw new Error("The Bloom fixture has no matching recording");
   const recordingId=recording.recordingId||recording.id,assetId=`81000000-0000-4000-8000-${String(recordings.indexOf(recording)+1).padStart(12,"0")}`,address=`/api/v2/recordings/${recordingId}/audio?assetId=${assetId}`;
   await route.fulfill({json:{status:"resolved",recording:{...recording,recordingId,metadata:recording.metadata||{title:recording.title,artists:recording.artists,durationMs:recording.durationMs}},playback:{url:address,fallbackUrl:address,assetId,sizeBytes:audio.length,sha256,mimeType:"audio/wav"}}});return true;
  }
  if(/^\/api\/v2\/recordings\/[^/]+\/audio$/.test(path)){
   const range=/bytes=(\d+)-(\d+)/.exec(request.headers().range||""),start=range?Number(range[1]):0,end=range?Math.min(Number(range[2]),audio.length-1):audio.length-1;
   await route.fulfill({status:range?206:200,contentType:"audio/wav",headers:{"Content-Length":String(end-start+1),"Accept-Ranges":"bytes",...(range?{"Content-Range":`bytes ${start}-${end}/${audio.length}`}:{})},body:audio.subarray(start,end+1)});return true;
  }
  return false;
 };
}
