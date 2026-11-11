import { productResponse } from "@/rebuild/data/http";
import { prepareBloom } from "@/rebuild/bloom/service";

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  const {id}=await context.params;
  return productResponse(request,account=>prepareBloom(account.id,id));
}
