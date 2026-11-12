import { withApiTiming } from "@/rebuild/server/performance";
import { getRebuildServices } from "@/rebuild/server/runtime";
import { cardsForIds } from "@/rebuild/data/catalog";
import { productResponse } from "@/rebuild/data/http";
import { ProductError,uuid } from "@/rebuild/data/validation";
import { isUuid,parseResolveInput } from "@/rebuild/server/input";
import { InputError } from "@/rebuild/server/contracts";
export async function GET(request:Request,context:{params:Promise<{recordingId:string}>}){
  return withApiTiming("/api/v2/recordings/[recordingId]", request, async () => {
 return productResponse(request,async account=>{
  const {recordingId}=await context.params;let canonicalId:string;
  if(isUuid(recordingId))canonicalId=uuid(recordingId,"recording ID");
  else{
   const [provider,id,...extra]=recordingId.split(":");if(extra.length)throw new ProductError(400,"Invalid song reference");
   let input;try{input=parseResolveInput({reference:{provider,id}});}catch(error){if(error instanceof InputError)throw new ProductError(400,"Invalid song reference");throw error;}
   canonicalId=(await getRebuildServices().ingestor.ensureRecording(input.reference,undefined,request.signal)).recordingId;
  }
  const [recording]=await cardsForIds(account.id,[canonicalId]);
  if(!recording)throw new ProductError(404,"Song not found");
  return recording;
 });

  });
}
