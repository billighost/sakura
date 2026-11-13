import { withApiTiming } from "@/rebuild/server/performance";
import { NextRequest, NextResponse } from "next/server";
import { requireRebuildAccount } from "@/rebuild/auth";
import { cardsForIds } from "@/rebuild/data/catalog";
import { uuid } from "@/rebuild/data/validation";
import { publishLyrics, LyricPublishError } from "@/rebuild/lyrics/publish";
import { sameRequestOrigin } from "@/rebuild/requestOrigin";
import { LyricRequestError } from "@/rebuild/lyrics/request";
import { ProductError } from "@/rebuild/data/validation";
import { parseTimedLyrics } from "@/rebuild/lyrics/parse";
import { VERIFIED_LYRICS_VERSION } from "@/rebuild/lyrics/versions";
import { resolveVerifiedLyrics } from "@/rebuild/lyrics/service";
import { recordingLyricIdentity } from "@/rebuild/lyrics/recordingIdentity";

export const maxDuration=60;
export async function POST(request:NextRequest) {
  return withApiTiming("/api/v2/lyrics/publish", request, async () => {
  try {
    if(!sameRequestOrigin(request))return NextResponse.json({error:"Invalid request origin"},{status:403});
    const account=await requireRebuildAccount();
    const expected=request.headers.get("X-Sakura-Account");
    if(!account||expected&&expected!==account.id)return NextResponse.json({error:"Unauthorized"},{status:401});
    const raw=await request.text();
    if(raw.length>100_000)throw new LyricRequestError("Lyrics are too large",413);
    let body:Record<string,unknown>;
    try{body=JSON.parse(raw);}catch{throw new LyricRequestError("Invalid JSON");}
    const recordingId=uuid(body?.recordingId,"recording ID");
    const track=(await cardsForIds(account.id,[recordingId]))[0];
    if(!track)throw new LyricRequestError("Verified recording not found",404);
    const identity=recordingLyricIdentity({ ...track, recordingId });
    const result=await publishLyrics(identity,body,{signal:request.signal,readback:false});
    resolveVerifiedLyrics.invalidate(identity);
    if(result.track)resolveVerifiedLyrics.remember(identity,{status:"matched",provider:"lrclib",track:result.track});
    const synced=result.track?.syncedLyrics?parseTimedLyrics(result.track.syncedLyrics):[];
    const hasSynced=synced.some(line=>line.text.trim());
    const lyrics=result.track?{lines:hasSynced?synced:(result.track.plainLyrics||"").split(/\r?\n/).map(text=>({text,start:0})),timing:hasSynced?"synced":"plain",provider:"lrclib",providerTrackId:result.track.id,instrumental:false,schemaVersion:VERIFIED_LYRICS_VERSION}:undefined;
    return NextResponse.json({published:true,lyricsAvailable:Boolean(result.track),lyrics},{status:result.track?201:202,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    if(error instanceof LyricPublishError)return NextResponse.json({error:error.message,reason:error.reason,retryAfterMs:error.retryAfterMs},{status:error.status,headers:{"Cache-Control":"private, no-store",...(error.retryAfterMs?{"Retry-After":String(Math.ceil(error.retryAfterMs/1000))}:{})}});
    if(error instanceof LyricRequestError||error instanceof ProductError)return NextResponse.json({error:error.message},{status:error.status});
    return NextResponse.json({error:"Lyrics publishing is temporarily unavailable"},{status:503});
  }

  });
}
