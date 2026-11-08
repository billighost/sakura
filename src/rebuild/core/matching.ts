import { normalizedRecording, referenceKey, isRecordingProofReference } from "./identity";
import type { AudioCandidate, RecordingRequest, VerifiedRecordingMetadataAlias, ProviderReference } from "./types";

export type MatchRejection = "preview" | "unverified-audio" | "missing-metadata" | "title" | "artist" | "version" | "explicit" | "duration" | "missing-duration" | "identifier-conflict";
export type CandidateAssessment = { candidate: AudioCandidate; acceptable: boolean; score: number; reasons: readonly MatchRejection[]; authoritativeMatch: boolean };

function identifierEvidence(request: RecordingRequest, candidate: RecordingRequest) {
  let shared = false;
  let conflict = false;
  for (const want of request.references ?? []) {
    for (const got of candidate.references ?? []) {
      if (want.provider !== got.provider || (want.scope ?? "") !== (got.scope ?? "")) continue;
      if (referenceKey(want) === referenceKey(got)) shared = true;
      // A different release's Deezer/Spotify ID need not be a different recording.
      // Conflicting ISRC or MB recording IDs, however, require explicit verification.
      else if (want.provider === "isrc" || want.provider === "musicbrainz") conflict = true;
    }
  }
  return { shared, conflict };
}

/** A generic label repeats its kind; a named mix, venue or year adds evidence.
 * Providers often expose `kinds:["remix"]` while ID3 exposes `(Remix)`. */
function versionEvidence(version: ReturnType<typeof normalizedRecording>["version"]) {
  const generic = /^(?:remix|mix|live|acoustic|instrumental|karaoke|demo|sped up|speed up|slowed|remaster|remastered|リミックス|ライブ|アコースティック|インストゥルメンタル|カラオケ|リマスター|混音|现场|現場)$/u;
  const labels=version.labels.map(label=>label.replace(/リミックス|混音/gu," remix ").replace(/ライブ|现场|現場/gu," live ").replace(/アコースティック/gu," acoustic ").replace(/インストゥルメンタル/gu," instrumental ").replace(/カラオケ/gu," karaoke ").replace(/リマスター/gu," remaster ").replace(/\bremastered\b/gu,"remaster").replace(/\bver\b/gu,"version").trim().replace(/\s+/gu," "));
  return {kinds:version.kinds,labels:[...new Set(labels.filter(label=>!generic.test(label)))].sort()};
}

/** Alternate writing is evidence only when a trusted catalogue read binds it
 * to this exact row or an authoritative recording ID. Variants, missing credit
 * information and changed duration cannot become spelling aliases. */
export function verifiedRecordingAliases(request: RecordingRequest): readonly VerifiedRecordingMetadataAlias[] {
  const want=normalizedRecording(request.metadata),aliases=request.metadata.verifiedAliases;
  if(!Array.isArray(aliases)||!want.title||!want.primaryArtist||!want.durationMs)return [];
  return aliases.slice(0,32).filter(alias=>{
    try{
      if(!alias||!alias.metadata||!Array.isArray(alias.metadata.artists)||alias.metadata.artistsComplete!==true||!Array.isArray(alias.references))return false;
      const identity=identifierEvidence(request,{metadata:alias.metadata,references:alias.references});
      if(!identity.shared||identity.conflict)return false;
      const sharedRecordingRef=(request.references??[]).some(wantRef=>isRecordingProofReference(wantRef)&&alias.references.some((gotRef:ProviderReference)=>isRecordingProofReference(gotRef)&&referenceKey(wantRef)===referenceKey(gotRef)));
      if(!sharedRecordingRef)return false;
      const got=normalizedRecording(alias.metadata);
      if(!got.title||!got.primaryArtist||!got.durationMs||Math.abs(want.durationMs!-got.durationMs)>Math.max(5000,want.durationMs!*.025))return false;
      if(request.metadata.artistsComplete!==false&&want.artists.length!==got.artists.length)return false;
      if(want.explicit!=="unknown"&&got.explicit!=="unknown"&&want.explicit!==got.explicit)return false;
      return JSON.stringify(versionEvidence(want.version))===JSON.stringify(versionEvidence(got.version));
    }catch{return false;}
  }).map(alias=>({
    metadata:{title:alias.metadata.title,artists:[...alias.metadata.artists],artistsComplete:true,durationMs:alias.metadata.durationMs,
      ...(alias.metadata.explicit!==undefined?{explicit:alias.metadata.explicit}:{}),
      ...(alias.metadata.version?{version:{kinds:[...(alias.metadata.version.kinds??[])],labels:[...(alias.metadata.version.labels??[])]}}:{})},
    references:alias.references.map((ref:ProviderReference)=>({provider:ref.provider,id:ref.id,...(ref.scope?{scope:ref.scope}:{})})),
  }));
}

/** Hard gates establish correctness before duration and audio quality can affect ranking. */
function assessStrictAudioCandidate(request: RecordingRequest, candidate: AudioCandidate): CandidateAssessment {
  const want = normalizedRecording(request.metadata);
  const got = normalizedRecording(candidate.metadata, want.artists);
  const identity = identifierEvidence(request, candidate);
  const reasons: MatchRejection[] = [];
  if (candidate.audioKind === "preview") reasons.push("preview");
  if (candidate.audioKind === "unknown") reasons.push("unverified-audio");
  if (!want.title || !got.title || !want.primaryArtist || !got.primaryArtist) reasons.push("missing-metadata");
  if (want.title !== got.title) reasons.push("title");
  const creditsMatch=request.metadata.artistsComplete===false
    ?want.artists.every(artist=>got.artists.includes(artist))
    :candidate.metadata.artistsComplete===false
      ?got.artists.every(artist=>want.artists.includes(artist))
      :JSON.stringify([...want.artists].sort())===JSON.stringify([...got.artists].sort());
  if (want.primaryArtist !== got.primaryArtist || !creditsMatch) reasons.push("artist");
  if (JSON.stringify(versionEvidence(want.version)) !== JSON.stringify(versionEvidence(got.version))) reasons.push("version");
  if (want.explicit !== "unknown" && got.explicit !== "unknown" && want.explicit !== got.explicit) reasons.push("explicit");
  if (identity.conflict) reasons.push("identifier-conflict");
  const difference = want.durationMs && got.durationMs ? Math.abs(want.durationMs - got.durationMs) : null;
  if (difference !== null && difference > Math.max(5000, want.durationMs! * 0.025)) reasons.push("duration");
  if (difference === null && !identity.shared) reasons.push("missing-duration");
  const acceptable = reasons.length === 0;
  const durationScore = difference === null ? 0 : Math.max(0, 20 - difference / 500);
  return { candidate, acceptable, score: acceptable ? 80 + durationScore + (identity.shared ? 200 : 0) : 0, reasons, authoritativeMatch: identity.shared && !identity.conflict };
}

/** Match one complete, provider-authorized spelling at a time. A localized
 * title/artist can change; the requested file's other safety gates cannot. */
export function assessAudioCandidate(request: RecordingRequest, candidate: AudioCandidate): CandidateAssessment {
  const canonical=assessStrictAudioCandidate(request,candidate);
  if(canonical.acceptable||canonical.reasons.some(reason=>reason!=="title"&&reason!=="artist"))return canonical;
  for(const alias of verifiedRecordingAliases(request)){
    const assessment=assessStrictAudioCandidate({metadata:alias.metadata,references:request.references},candidate);
    if(assessment.acceptable)return assessment;
  }
  return canonical;
}

export type AudioSelection =
  | { status: "matched"; candidate: AudioCandidate; assessments: readonly CandidateAssessment[] }
  | { status: "ambiguous"; candidates: readonly AudioCandidate[]; assessments: readonly CandidateAssessment[] }
  | { status: "unavailable"; assessments: readonly CandidateAssessment[] };

/** Never return the first result solely because the provider found something. */
export function selectAudioCandidate(request: RecordingRequest, candidates: readonly AudioCandidate[]): AudioSelection {
  const assessments = candidates.map((candidate) => assessAudioCandidate(request, candidate));
  const valid = assessments.filter((result) => result.acceptable).sort((a, b) => b.score - a.score);
  if (!valid.length) return { status: "unavailable", assessments };
  if (valid.length === 1) return { status: "matched", candidate: valid[0].candidate, assessments };
  const best = valid[0];
  const near = valid.filter((result) => best.score - result.score < 5);
  if (near.length === 1) return { status: "matched", candidate: best.candidate, assessments };
  // Multiple encodings of one *verified* recording are safe to select by quality.
  const verifiedKeys = (candidate: AudioCandidate) => new Set((candidate.references ?? [])
    .filter((ref) => ref.provider === "isrc" || ref.provider === "musicbrainz")
    .map(referenceKey));
  const bestKeys = verifiedKeys(best.candidate);
  const sameRecording = bestKeys.size > 0 && near.every((result) => [...verifiedKeys(result.candidate)].some((key) => bestKeys.has(key)));
  if (sameRecording) {
    near.sort((a, b) => (b.candidate.bitrateKbps ?? 0) - (a.candidate.bitrateKbps ?? 0));
    return { status: "matched", candidate: near[0].candidate, assessments };
  }
  return { status: "ambiguous", candidates: near.map((result) => result.candidate), assessments };
}
