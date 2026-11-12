import { withApiTiming } from "@/rebuild/server/performance";
import { requireRebuildAccount } from "@/rebuild/auth";
import { getRebuildServices } from "@/rebuild/server/runtime";
import { readResolveInput } from "@/rebuild/server/input";
import { RecordingIdentityConflict } from "@/rebuild/server/ingestion";
import { InputError } from "@/rebuild/server/contracts";
export async function POST(request: Request) {
  return withApiTiming("/api/v2/recordings/index", request, async () => {
  try {
    const account = await requireRebuildAccount();
    if (!account) return Response.json({ error: "Unauthorized" },{ status: 401,headers:{"Cache-Control":"private, no-store"} });
    const input = await readResolveInput(request);
    const recording = await getRebuildServices().ingestor.ensureRecording(input.reference,input.expected,request.signal);
    return Response.json({ recording },{ headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if(error instanceof InputError)return Response.json({error:error.message},{status:400});
    if (error instanceof RecordingIdentityConflict) return Response.json({status:"review",reason:error.reason,error:error.message,candidates:error.candidates.map(recording=>({title:recording.metadata.title,artists:recording.metadata.artists,durationMs:recording.metadata.durationMs??null,reference:recording.references?.find(ref=>ref.provider==="deezer"||ref.provider==="spotify"),reasons:error.rejections}))},{status:409});
    return Response.json({ error: "Could not index this recording." },{ status: 503,headers:{"Cache-Control":"private, no-store"} });
  }

  });
}
