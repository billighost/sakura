import { requireRebuildAccount } from "@/rebuild/auth";
import { getRebuildServices } from "@/rebuild/server/runtime";
import { readRequestJson } from "@/rebuild/server/input";
import { InputError } from "@/rebuild/server/contracts";
export const maxDuration=300;
export async function POST(request:Request){
 const account=await requireRebuildAccount();if(!account)return Response.json({error:"Unauthorized"},{status:401});
 try{const body=await readRequestJson(request) as {url?:string;confirm?:boolean};if(!body||typeof body.url!=="string"||body.url.length>2000||typeof body.confirm!=="boolean")return Response.json({error:"A playlist URL and confirmation choice are required."},{status:400});
  const importer=getRebuildServices().importer;const result=body.confirm?await importer.confirm(account.id,body.url):await importer.preview(body.url);return Response.json(result,{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"This playlist could not be imported."},{status:error instanceof InputError?400:422});}
}
