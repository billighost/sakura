import { requireRebuildAccount, type RebuildAccount } from "../auth";
import { ProductError, object } from "./validation";
import { sameRequestOrigin } from "../requestOrigin";
import { readBoundedRequestText, RequestBodyError } from "../server/request-body";
import { normalizeProductDto } from "../app/productDto";
import {measureApiStage} from "../server/performance";

export function compactProductRequest(request:Request){return request.headers.get("X-Sakura-DTO")==="3";}

export async function jsonBody(request: Request,maximum=98304): Promise<Record<string,unknown>> {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  if (contentType !== "application/json") throw new ProductError(415,"Use application/json");
  let body:string;
  try{body=await readBoundedRequestText(request,maximum);}catch(error){if(error instanceof RequestBodyError)throw new ProductError(error.status,error.message);throw error;}
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
    const headers={"Cache-Control":"private, no-store","Vary":"Cookie, X-Sakura-DTO, X-Sakura-Sync","X-Sakura-Schema":"2",...(compactProductRequest(request)?{"X-Sakura-DTO":"3"}:{})};
    if(result instanceof Response){for(const [key,value]of Object.entries(headers))result.headers.set(key,value);return result;}
    return measureApiStage("serialize",()=>Response.json(compactProductRequest(request)?normalizeProductDto(result):result,{headers}));
  } catch (error) {
    if (error instanceof ProductError) return Response.json({error:error.message},{status:error.status,headers:{"Cache-Control":"private, no-store"}});
    console.error("[Sakura v2 product] Request failed",error instanceof Error ? error.name : "UnknownError");
    return Response.json({error:"The service is temporarily unavailable"},{status:503,headers:{"Cache-Control":"private, no-store"}});
  }
}
