import { withApiTiming } from "@/rebuild/server/performance";
import { jsonBody, productResponse } from "@/rebuild/data/http";
import { removeTaste, setTaste } from "@/rebuild/data/taste";
import { getTasteState } from "@/rebuild/data/tasteState";
export async function GET(request:Request){
  return withApiTiming("/api/v2/taste", request, async () => {return productResponse(request,account=>getTasteState(account.id,{sync:request.headers.get("X-Sakura-Sync")==="1"}));
  });
}
export async function POST(request:Request){
  return withApiTiming("/api/v2/taste", request, async () => {return productResponse(request,async account=>setTaste(account.id,await jsonBody(request)));
  });
}
export async function DELETE(request:Request){
  return withApiTiming("/api/v2/taste", request, async () => {return productResponse(request,async account=>removeTaste(account.id,await jsonBody(request)));
  });
}
