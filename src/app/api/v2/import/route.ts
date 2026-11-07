import { requireRebuildAccount } from "@/rebuild/auth";
import { getRebuildServices } from "@/rebuild/server/runtime";
import { readRequestJson } from "@/rebuild/server/input";
import { InputError } from "@/rebuild/server/contracts";
import {sameRequestOrigin} from "@/rebuild/requestOrigin";
import {uuid,ProductError} from "@/rebuild/data/validation";
export const maxDuration=300;
export async function POST(request:Request){
 if(!sameRequestOrigin(request))return Response.json({error:"Invalid request origin"},{status:403});
 const account=await requireRebuildAccount();if(!account)return Response.json({error:"Unauthorized"},{status:401});
 if(request.headers.get("X-Sakura-Account")&&request.headers.get("X-Sakura-Account")!==account.id)return Response.json({error:"Session changed"},{status:401});
 try{const body=await readRequestJson(request) as {url?:string;confirm?:boolean;requestId?:string};if(!body||typeof body.url!=="string"||body.url.length>2000||typeof body.confirm!=="boolean")return Response.json({error:"A playlist URL and confirmation choice are required."},{status:400});
  const requestId=body.requestId===undefined?undefined:uuid(body.requestId,"import request ID");
  const importer=getRebuildServices().importer;const result=body.confirm?await importer.confirm(account.id,body.url,requestId):await importer.preview(body.url);return Response.json(result,{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"This playlist could not be imported."},{status:error instanceof InputError?400:error instanceof ProductError?error.status:422});}
}
