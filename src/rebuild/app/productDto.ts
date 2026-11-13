/** Upgrade older installed/offline envelopes without copying every song card. */
export function normalizeProductDto<T>(value:T):T {
  if(!value||typeof value!=="object"||Array.isArray(value))return value;
  const original=value as Record<string,unknown>;
  let result=original;
  const remove=(key:string)=>{if(key in result){if(result===original)result={...original};delete result[key];}};
  if(Array.isArray(original.recordings))remove("tracks");
  else if(Array.isArray(original.tracks)&&("trackCount" in original||"kind" in original)){
    result={...original,recordings:original.tracks};remove("tracks");
  }
  const events=Array.isArray(original.events)?original.events:Array.isArray(original.history)?original.history:null;
  if(events){
    let changed=false;
    const normalized=events.map(event=>{
      if(!event||typeof event!=="object")return event;
      const row=event as Record<string,unknown>,recording=row.recording??row.track;
      if(!recording||!("track" in row))return event;
      changed=true;const copy:Record<string,unknown>={...row,recording};delete copy.track;return copy;
    });
    if(changed||!Array.isArray(original.events)){if(result===original)result={...original};result.events=normalized;}
    remove("history");
  }
  if(original.favoriteStates&&typeof original.favoriteStates==="object")remove("favoriteRevisions");
  if(original.insights&&typeof original.insights==="object"){
    // Raw account-scoring evidence has its own authoritative /taste transport.
    remove("tasteEvidence");remove("tasteFeedback");
    const insights=original.insights as Record<string,unknown>;
    if("tasteEvidence" in insights||"tasteFeedback" in insights){
      if(result===original)result={...original};
      const copy={...insights};delete copy.tasteEvidence;delete copy.tasteFeedback;result.insights=copy;
    }
  }
  return result as T;
}
