import {assessAudioCandidate} from "../core/matching";
import type {CanonicalRecording} from "../core/types";
import type {StoredAudioAsset} from "./contracts";

/** Structural/container and embedded-metadata checks complement byte integrity.
 * They do not establish an acoustic fingerprint or decode every codec frame. */
export async function inspectFullAudio(bytes:Buffer,recording:CanonicalRecording,source:StoredAudioAsset){
 const {parseBuffer}=await import("music-metadata");
 const parsed=await parseBuffer(bytes,{mimeType:source.mimeType,size:bytes.length},{duration:true,skipCovers:true});
 const durationMs=Math.round(Number(parsed.format.duration)*1000);
 if(!parsed.format.container||!parsed.format.codec||!Number.isSafeInteger(durationMs)||durationMs<=0)throw new Error("Audio container has no verified duration or codec");
 const expected=recording.metadata.durationMs;
 if(!expected||Math.abs(durationMs-expected)>Math.max(5000,expected*.025))throw new Error("Audio container duration does not match this recording");
 const title=parsed.common.title;
 const artists=parsed.common.artists|| (parsed.common.artist?[parsed.common.artist]:undefined);
 // Absent optional tags do not override already verified source metadata.
 // Present tags, including significant version labels, must agree as a whole.
 const metadata={...source.candidate.metadata,durationMs,...(title?{title}:{}),...(artists?.length?{artists,artistsComplete:true}:{})};
 const candidate={...source.candidate,metadata};
 if(!assessAudioCandidate(recording,candidate).acceptable)throw new Error("Embedded audio metadata does not match this recording");
 return {container:parsed.format.container,codec:parsed.format.codec,durationMs};
}
