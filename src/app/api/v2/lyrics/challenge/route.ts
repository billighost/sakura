import { withApiTiming } from "@/rebuild/server/performance";
import { NextRequest, NextResponse } from "next/server";
import { requireRebuildAccount } from "@/rebuild/auth";
import { sameRequestOrigin } from "@/rebuild/requestOrigin";
import { LyricPublishError, requestPublishChallenge, parseLyricSubmission, validateLyricPublishIdentity } from "@/rebuild/lyrics/publish";
import { LyricRequestError } from "@/rebuild/lyrics/request";
import { jsonBody } from "@/rebuild/data/http";
import { cardsForIds } from "@/rebuild/data/catalog";
import { ProductError, uuid } from "@/rebuild/data/validation";
import { recordingLyricIdentity } from "@/rebuild/lyrics/recordingIdentity";

export const maxDuration=20;
export async function POST(request:NextRequest){
  return withApiTiming("/api/v2/lyrics/challenge", request, async () => {
  const headers={"Cache-Control":"private, no-store"};
  try{
    if(!sameRequestOrigin(request))return NextResponse.json({error:"Invalid request origin"},{status:403,headers});
    const account=await requireRebuildAccount(),expected=request.headers.get("X-Sakura-Account");
    if(!account||expected&&expected!==account.id)return NextResponse.json({error:"Unauthorized"},{status:401,headers});
    const body=await jsonBody(request),recordingId=uuid(body.recordingId,"recording ID");
    const track=(await cardsForIds(account.id,[recordingId]))[0];
    if(!track)throw new LyricRequestError("Verified recording not found",404);
    // Proof is independent of the manuscript. Prepare it while the contributor
    // edits; the publish endpoint still validates every submitted word and time.
    const identity=recordingLyricIdentity({ ...track, recordingId });
    validateLyricPublishIdentity(identity);
    if(body.text!==undefined||body.format!==undefined)parseLyricSubmission(body,identity);
    return NextResponse.json(await requestPublishChallenge({signal:request.signal}),{headers});
  }catch(error){
    if(error instanceof LyricPublishError)return NextResponse.json({error:error.message,reason:error.reason,retryAfterMs:error.retryAfterMs},{status:error.status,headers:{...headers,...(error.retryAfterMs?{"Retry-After":String(Math.ceil(error.retryAfterMs/1000))}:{})}});
    if(error instanceof LyricRequestError||error instanceof ProductError)return NextResponse.json({error:error.message},{status:error.status,headers});
    return NextResponse.json({error:"LRCLIB publishing is temporarily unavailable. Your draft is kept.",reason:"lyrics-publish-unavailable"},{status:503,headers});
  }

  });
}
