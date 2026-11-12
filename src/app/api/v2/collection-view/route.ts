import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse, jsonBody } from "@/rebuild/data/http";
import { collectionRoom, getCollectionView, patchCollectionView } from "@/rebuild/data/collectionViews";

export async function GET(request:Request){
  return withApiTiming("/api/v2/collection-view", request, async () => {return productResponse(request,async account=>{
 const room=collectionRoom(new URL(request.url).searchParams.get("room"));
 return {room,preference:await getCollectionView(account.id,room)};
});
  });
}
export async function PATCH(request:Request){
  return withApiTiming("/api/v2/collection-view", request, async () => {return productResponse(request,async account=>{
 const body=await jsonBody(request),room=collectionRoom(body.room);
 return {room,preference:await patchCollectionView(account.id,room,body)};
});
  });
}
