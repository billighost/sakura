import { withApiTiming } from "@/rebuild/server/performance";
import {jsonBody,productResponse} from "@/rebuild/data/http";
import {getSession,putSession} from "@/rebuild/data/session";
export async function GET(request:Request){
  return withApiTiming("/api/v2/listening-session", request, async () => {return productResponse(request,a=>getSession(a.id));
  });
}
export async function PUT(request:Request){
  return withApiTiming("/api/v2/listening-session", request, async () => {return productResponse(request,async a=>putSession(a.id,await jsonBody(request)));
  });
}
