import { requireRebuildAccount, type RebuildAccount } from "../auth";
import { ProductError, object } from "./validation";
import { sameRequestOrigin } from "../requestOrigin";

export async function jsonBody(request: Request): Promise<Record<string,unknown>> {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  if (contentType !== "application/json") throw new ProductError(415,"Use application/json");
  const maximum=98304;
  if(Number(request.headers.get("content-length"))>maximum)throw new ProductError(413,"Request is too large");
  const reader=request.body?.getReader();
  if(!reader)throw new ProductError(400,"Request body is missing");
  const parts:Uint8Array[]=[];let length=0;
  try{while(true){
    const result=await reader.read();if(result.done)break;
    length+=result.value.byteLength;if(length>maximum){await reader.cancel();throw new ProductError(413,"Request is too large");}
    parts.push(result.value);
  }}finally{reader.releaseLock();}
  const body=Buffer.concat(parts.map(part=>Buffer.from(part))).toString("utf8");
  try { return object(JSON.parse(body)); } catch (error) {
    if (error instanceof ProductError) throw error;
    throw new ProductError(400,"Invalid JSON");
  }
}
export async function productResponse(request: Request, operation: (account:RebuildAccount) => Promise<unknown>): Promise<Response> {
  try {
    if (!["GET","HEAD"].includes(request.method)) {
      if (!sameRequestOrigin(request)) throw new ProductError(403,"Invalid request origin");
    }
    const account = await requireRebuildAccount();
    if (!account) return Response.json({error:"Unauthorized"},{status:401,headers:{"Cache-Control":"private, no-store"}});
    const expectedAccount=request.headers.get("X-Sakura-Account");if(expectedAccount&&expectedAccount!==account.id)return Response.json({error:"Session changed"},{status:401,headers:{"Cache-Control":"private, no-store"}});
    const result = await operation(account);
    return Response.json(result,{headers:{"Cache-Control":"private, no-store","Vary":"Cookie","X-Sakura-Schema":"2"}});
  } catch (error) {
    if (error instanceof ProductError) return Response.json({error:error.message},{status:error.status,headers:{"Cache-Control":"private, no-store"}});
    console.error("[Sakura v2 product] Request failed",error instanceof Error ? error.name : "UnknownError");
    return Response.json({error:"The service is temporarily unavailable"},{status:503,headers:{"Cache-Control":"private, no-store"}});
  }
}
